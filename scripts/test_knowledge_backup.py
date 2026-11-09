import io
import json
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import knowledge_backup as kb


def sample_manifest():
    return {"format": 1, "database": "ai_knowledge_db", "counts": {"documents": 3, "document_chunks": 20},
            "vectors": {}, "models": [], "weaviateHostname": "original-node",
            "ragEnvironment": {"EMBEDDING_MODEL": "bge-m3", "OLLAMA_MODEL": "gemma2:2b"},
            "images": {service: {"id": "sha256:" + "a" * 64, "os": "linux", "architecture": "amd64"} for service in kb.SERVICES},
            "files": {}}


def volume(path, name="./documents/1_document.pdf", link=False):
    with tarfile.open(path, "w") as archive:
        info = tarfile.TarInfo(name)
        if link:
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            archive.addfile(info)
        else:
            content = b"document-content"
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


def fixture(directory, *, nested_name=None, link=False, tamper=False, extra=None, mode=None):
    manifest = sample_manifest()
    if mode:
        manifest.update(format=2, mode=mode)
    files = kb.payload_files(manifest)
    for name in files:
        path = directory / name
        if name in {"uploads.tar", "weaviate.tar", "ollama.tar"}:
            volume(path, nested_name or "./documents/1_document.pdf", link)
        else:
            path.write_bytes(b"test fixture content")
        manifest["files"][name] = {"size": path.stat().st_size, "sha256": kb.sha(path)}
    if tamper:
        (directory / "database.sql").write_bytes(b"corrupted")
    (directory / "manifest.json").write_text(json.dumps(manifest))
    output = directory / "backup.akb.tar"
    with tarfile.open(output, "w") as archive:
        for name in sorted(files | {"manifest.json"}):
            archive.add(directory / name, arcname=name)
        if extra:
            info = tarfile.TarInfo(extra)
            info.size = 0
            archive.addfile(info, io.BytesIO())
    return output


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        self.source = self.root / "source"
        self.destination = self.root / "target"
        self.source.mkdir()
        self.destination.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def test_complete_archive_verifies_all_payloads(self):
        manifest = kb.verify_archive(fixture(self.source), self.destination)
        self.assertEqual(manifest["counts"]["documents"], 3)
        self.assertEqual(set(p.name for p in self.destination.iterdir()), kb.FILES | {"manifest.json"})

    def test_standard_archive_contains_knowledge_but_no_models_or_images(self):
        path = fixture(self.source, mode="standard")
        manifest = kb.verify_archive(path, self.destination)
        self.assertEqual(manifest["mode"], "standard")
        self.assertEqual(set(p.name for p in self.destination.iterdir()), kb.DATA_FILES | {"manifest.json"})
        self.assertFalse((self.destination / "images.tar").exists())
        self.assertFalse((self.destination / "ollama.tar").exists())
        self.assertIn("models", manifest)
        self.assertEqual(set(manifest["images"]), set(kb.SERVICES))

    def test_new_full_archive_and_legacy_archive_remain_supported(self):
        for mode in ("full", None):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                source, target = root / "source", root / "target"
                source.mkdir(); target.mkdir()
                manifest = kb.verify_archive(fixture(source, mode=mode), target)
                self.assertEqual(kb.payload_files(manifest), kb.FILES)

    def test_unknown_backup_mode_is_rejected(self):
        with self.assertRaises(kb.Failure):
            kb.payload_files({"format": 2, "mode": "partial"})

    def test_installed_exact_image_does_not_trigger_network_pull(self):
        image = sample_manifest()["images"]["app"]
        with patch.object(kb, "run", return_value=json.dumps([{"Id": image["id"]}]).encode()) as run:
            self.assertEqual(kb.resolve_image("app", image), image["id"])
            self.assertEqual(run.call_count, 1)

    def test_missing_image_is_pulled_only_by_recorded_immutable_digest(self):
        image = sample_manifest()["images"]["mysql"]
        image["repoDigests"] = ["mysql@sha256:" + "b" * 64]
        with patch.object(kb, "run", side_effect=[kb.Failure("missing"), b"", json.dumps([{"Id": image["id"]}]).encode()]) as run:
            kb.resolve_image("mysql", image)
            self.assertEqual(run.call_args_list[1].args[0], ["docker", "image", "pull", image["repoDigests"][0]])

    def test_unavailable_local_only_app_image_fails_without_latest_fallback(self):
        with patch.object(kb, "run", side_effect=kb.Failure("missing")) as run:
            with self.assertRaisesRegex(kb.Failure, "Exact app image is unavailable"):
                kb.resolve_image("app", sample_manifest()["images"]["app"])
            self.assertEqual(run.call_count, 1)

    def test_installed_models_are_reused_and_extra_cached_models_are_allowed(self):
        models = [{"name": "bge-m3:latest", "digest": "recorded"}]
        with patch.object(kb, "http_json", return_value={"models": models + [{"name": "other", "digest": "extra"}]}), patch.object(kb, "run") as run:
            kb.ensure_models("app", "ollama", models)
            run.assert_not_called()

    def test_missing_model_is_downloaded_into_isolated_ollama_and_verified(self):
        models = [{"name": "bge-m3:latest", "digest": "recorded"}]
        with patch.object(kb, "http_json", side_effect=[{"models": []}, {"models": models}]), patch.object(kb, "run") as run:
            kb.ensure_models("app", "isolated-ollama", models)
            run.assert_called_once_with(["docker", "exec", "isolated-ollama", "ollama", "pull", "bge-m3:latest"])

    def test_downloaded_newer_model_is_rejected_without_rebuilding_vectors(self):
        with patch.object(kb, "http_json", side_effect=[{"models": []}, {"models": [{"name": "bge-m3:latest", "digest": "different"}]}]), patch.object(kb, "run"):
            with self.assertRaisesRegex(kb.Failure, "does not match"):
                kb.ensure_models("app", "isolated", [{"name": "bge-m3:latest", "digest": "recorded"}])

    def test_local_model_copy_mounts_original_readonly_and_new_volume_writable(self):
        source = {"Config": {"Env": []}, "Mounts": [{"Destination": "/root/.ollama", "Type": "volume", "Name": "original-models"}]}
        with patch.object(kb, "compose", return_value=b"original-ollama"), patch.object(kb, "inspect", return_value=source), patch.object(kb, "run", return_value=b"") as run:
            self.assertTrue(kb.copy_local_models("new-isolated-models", "app-image"))
            command = run.call_args.args[0]
            self.assertIn("type=volume,src=original-models,dst=/cache,readonly", command)
            self.assertIn("type=volume,src=new-isolated-models,dst=/restore", command)

    def test_corrupted_sql_rejected_before_docker(self):
        with self.assertRaisesRegex(kb.Failure, "checksum"):
            kb.verify_archive(fixture(self.source, tamper=True), self.destination)

    def test_unknown_files_and_env_are_rejected(self):
        with self.assertRaisesRegex(kb.Failure, "unexpected"):
            kb.verify_archive(fixture(self.source, extra=".env"), self.destination)

    def test_duplicate_manifest_is_rejected(self):
        with self.assertRaisesRegex(kb.Failure, "duplicate"):
            kb.verify_archive(fixture(self.source, extra="manifest.json"), self.destination)

    def test_outer_escape_is_rejected_without_writing_outside_destination(self):
        with self.assertRaises(kb.Failure):
            kb.verify_archive(fixture(self.source, extra="../escaped"), self.destination)
        self.assertFalse((self.root / "escaped").exists())

    def test_nested_escape_is_rejected(self):
        with self.assertRaisesRegex(kb.Failure, "Unsafe path"):
            kb.verify_archive(fixture(self.source, nested_name="../escaped"), self.destination)

    def test_nested_symlink_is_rejected(self):
        with self.assertRaisesRegex(kb.Failure, "Links/devices"):
            kb.verify_archive(fixture(self.source, link=True), self.destination)

    @unittest.skipUnless(shutil.which("node"), "Node is needed to verify the in-container checker")
    def test_restored_file_checker_detects_changed_document_bytes(self):
        volume(self.source / "uploads.tar")
        files = kb.uploads_inventory(self.source / "uploads.tar")
        (self.destination / "documents").mkdir()
        document = self.destination / "documents" / "1_document.pdf"
        document.write_bytes(b"document-content")
        data = json.dumps({"root": str(self.destination), "files": files}).encode()
        success = subprocess.run(["node", "-e", kb.VERIFY_FILES_NODE], input=data, capture_output=True)
        self.assertEqual(success.returncode, 0)
        document.write_bytes(b"changed-document")
        damaged = subprocess.run(["node", "-e", kb.VERIFY_FILES_NODE], input=data, capture_output=True)
        self.assertNotEqual(damaged.returncode, 0)

    @unittest.skipUnless(shutil.which("node"), "Node is needed to verify the in-container checker")
    def test_restored_file_checker_rejects_paths_outside_uploads(self):
        data = json.dumps({"root": str(self.destination), "files": {"../escape": {"size": 0, "sha256": ""}}}).encode()
        result = subprocess.run(["node", "-e", kb.VERIFY_FILES_NODE], input=data, capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_restoration_never_reuses_original_volumes_or_ports(self):
        manifest = sample_manifest()
        target_env = {"JWT_SECRET": "target-secret", "EMBEDDING_MODEL": "wrong-model", "BITRIX24_INBOUND_SECRET": "target-bitrix"}
        spec = kb.restore_spec(manifest, {service: "snapshot-image" for service in kb.SERVICES}, "uniqueid", 3210, target_env, self.destination)
        self.assertTrue(all(volume["name"].startswith("assist_kb_uniqueid_") for volume in spec["volumes"].values()))
        self.assertEqual(spec["services"]["app"]["ports"][0]["host_ip"], "127.0.0.1")
        self.assertEqual(spec["services"]["app"]["ports"][0]["published"], "3210")
        app = spec["services"]["app"]["environment"]
        self.assertEqual(app["JWT_SECRET"], "target-secret")
        self.assertEqual(app["BITRIX24_INBOUND_SECRET"], "target-bitrix")
        self.assertEqual(app["EMBEDDING_MODEL"], "bge-m3")
        self.assertEqual(app["SANEXT_SYNC_DISABLED"], "true")
        self.assertEqual(app["RUN_DB_MIGRATIONS"], "true")
        self.assertEqual(app["MIGRATIONS_FAIL_OPEN"], "false")
        self.assertEqual(spec["services"]["weaviate"]["hostname"], "original-node")
        self.assertNotIn("env_file", spec["services"]["app"])

    def test_backup_cannot_override_target_secrets_via_portable_settings(self):
        manifest = sample_manifest()
        manifest["ragEnvironment"]["JWT_SECRET"] = "source-secret"
        with self.assertRaisesRegex(kb.Failure, "Unexpected environment"):
            kb.restore_spec(manifest, {}, "test", 3210, {}, self.destination)

    def test_database_name_cannot_inject_a_connection_string(self):
        manifest = sample_manifest()
        manifest["database"] = "db?host=elsewhere"
        with self.assertRaisesRegex(kb.Failure, "database name"):
            kb.restore_spec(manifest, {}, "test", 3210, {}, self.destination)

    def test_dependency_resume_failure_does_not_skip_app_resume(self):
        state = {key: {"Id": key} for key in kb.SERVICES}
        with patch.object(kb, "run") as run, patch.object(kb, "wait_ready", side_effect=[kb.Failure("unhealthy"), None, None]):
            with self.assertRaisesRegex(kb.Failure, "weaviate"):
                kb.resume_sources(state, ["app", "weaviate", "ollama"])
            self.assertEqual([call.args[0][-1] for call in run.call_args_list], ["weaviate", "ollama", "app"])

    def test_control_question_requires_document_sources(self):
        with patch.object(kb, "http_json", side_effect=[{"enabled": False}, {"response": "expected answer", "sources": []}]):
            with self.assertRaisesRegex(kb.Failure, "Control question"):
                kb.question_check("candidate", "question", "expected")

    def test_control_question_requires_expected_content(self):
        with patch.object(kb, "http_json", side_effect=[{"enabled": False}, {"response": "fallback", "sources": [{"documentId": 1}]}]):
            with self.assertRaisesRegex(kb.Failure, "Control question"):
                kb.question_check("candidate", "question", "expected")

    def test_control_question_supports_archived_widget_without_consent_endpoint(self):
        with patch.object(kb, "http_json", side_effect=[None, {"response": "expected answer", "sources": [{"documentId": 1}]}]) as http:
            self.assertEqual(kb.question_check("candidate", "question", "expected")["sourceCount"], 1)
            self.assertTrue(http.call_args_list[0].kwargs["allow_missing"])

    def test_control_question_supports_required_consent(self):
        with patch.object(kb, "http_json", side_effect=[{"enabled": True, "version": "v1"}, {"token": "receipt"},
                {"response": "EXPECTED answer", "sources": [{"documentId": 1}]}]) as http:
            self.assertEqual(kb.question_check("candidate", "question", "expected")["sourceCount"], 1)
            self.assertEqual(http.call_args_list[-1].args[3]["consentToken"], "receipt")

    def test_embedding_model_accepts_modern_and_legacy_api(self):
        with patch.object(kb, "http_json", return_value={"embeddings": [[0.1, 0.2]]}):
            kb.check_embedding("app", "model", 2)
        with patch.object(kb, "http_json", side_effect=[kb.Failure("404"), {"embedding": [0.1, 0.2]}]):
            kb.check_embedding("app", "model", 2)

    def test_embedding_dimension_change_is_rejected(self):
        with patch.object(kb, "http_json", return_value={"embeddings": [[0.1]]}):
            with self.assertRaisesRegex(kb.Failure, "dimension"):
                kb.check_embedding("app", "model", 1024)

    def staged_copy(self):
        directory = self.root / "restore-fixture"
        directory.mkdir()
        spec = kb.restore_spec(sample_manifest(), {service: "snapshot" for service in kb.SERVICES},
                               "fixture", 3210, {}, directory)
        kb.private_json(directory / "compose.json", spec)
        kb.private_json(directory / "restore-state.json", {"verified": True, "targetSync": "false",
                                                           "control": {"question": "q", "expected": "answer"}})
        return directory

    def test_failed_switch_restarts_original_app_and_does_not_mark_copy_active(self):
        directory = self.staged_copy()
        original = {service: {"Id": "old-" + service} for service in kb.SERVICES}
        target = {"services": {"app": {"ports": [{"published": "3000", "target": 3000}]}}}
        def compose(*args, **kwargs):
            if args[0] == "config":
                return json.dumps(target).encode()
            if args[0] == "up":
                raise kb.Failure("candidate failed to bind")
            return b""
        with patch.object(kb, "STORE", self.root), patch.object(kb, "ACTIVE", self.root / "active.json"), \
             patch.object(kb, "source_state", return_value=original), patch.object(kb, "restored_ids", return_value={service: "new-" + service for service in kb.SERVICES}), \
             patch.object(kb, "question_check"), patch.object(kb, "compose", side_effect=compose) as composed, patch.object(kb, "run", return_value=b"") as run:
            with self.assertRaisesRegex(kb.Failure, "candidate failed"):
                kb.promote(directory)
            self.assertIn(["docker", "start", "old-app"], [call.args[0] for call in run.call_args_list])
            self.assertTrue(any(call.args == ("stop", "app") for call in composed.call_args_list))
            self.assertFalse((self.root / "active.json").exists())
            self.assertFalse(json.loads((directory / "restore-state.json").read_text())["verified"])

    def test_successful_switch_retains_previous_services_and_rollback_restores_them(self):
        directory = self.staged_copy()
        original = {service: {"Id": "old-" + service} for service in kb.SERVICES}
        target = {"services": {"app": {"ports": [{"published": "3000", "target": 3000}]}}}
        def compose(*args, **kwargs):
            return json.dumps(target).encode() if args[0] == "config" else b""
        with patch.object(kb, "STORE", self.root), patch.object(kb, "ACTIVE", self.root / "active.json"), \
             patch.object(kb, "source_state", return_value=original), patch.object(kb, "restored_ids", return_value={service: "new-" + service for service in kb.SERVICES}), \
             patch.object(kb, "question_check"), patch.object(kb, "compose", side_effect=compose), \
             patch.object(kb, "http_json", return_value={"ok": True}), patch.object(kb, "wait_ready"), patch.object(kb, "run", return_value=b"") as run:
            kb.promote(directory)
            self.assertTrue((self.root / "active.json").exists())
            switched = json.loads((directory / "compose.json").read_text())
            self.assertEqual(switched["services"]["app"]["ports"][0]["published"], "3000")
            previous = json.loads((directory / "previous.json").read_text())
            self.assertEqual(previous["services"]["mysql"], "old-mysql")
            kb.rollback(directory)
            self.assertFalse((self.root / "active.json").exists())
            for service in kb.SERVICES:
                self.assertIn(["docker", "start", "old-" + service], [call.args[0] for call in run.call_args_list])
            self.assertTrue((directory / "compose.json").exists())

    def test_backup_failure_while_paused_still_resumes_original_app(self):
        state = {service: {"Id": service, "Image": "snapshot", "Config": {"Hostname": service, "Env": []},
                 "Mounts": [], "NetworkSettings": {"Networks": {"original-network": {}}}} for service in kb.SERVICES}
        state["mysql"]["Config"]["Env"] = ["MYSQL_DATABASE=existing"]
        state["app"]["Config"]["Env"] = ["DATABASE_URL=mysql://user:fixture@mysql:3306/existing"]
        for name, (service, target) in kb.TARGETS.items():
            state[service]["Mounts"].append({"Destination": target, "Type": "volume", "Name": name})
        image = {"Id": "snapshot", "Os": "linux", "Architecture": "amd64"}
        def run(args, **kwargs):
            return json.dumps([image]).encode() if args[:3] == ["docker", "image", "inspect"] else b""
        with patch.object(kb, "STORE", self.root), patch.object(kb, "source_state", return_value=state), \
             patch.object(kb, "run", side_effect=run), patch.object(kb, "vector_counts", side_effect=kb.Failure("probe failed")), \
             patch.object(kb, "resume_sources") as resume:
            with self.assertRaisesRegex(kb.Failure, "probe failed"):
                kb.backup(self.root / "new.akb.tar")
            resume.assert_called_once_with(state, ["app"])
            self.assertFalse((self.root / "new.akb.tar").exists())

    def test_default_backup_never_saves_images_or_model_bytes_or_stops_ollama(self):
        state = {service: {"Id": service, "Image": "snapshot", "Config": {"Hostname": service, "Env": []},
                 "Mounts": [], "NetworkSettings": {"Networks": {"original-network": {}}}} for service in kb.SERVICES}
        state["mysql"]["Config"]["Env"] = ["MYSQL_DATABASE=existing"]
        state["app"]["Config"]["Env"] = ["DATABASE_URL=mysql://user:fixture@mysql:3306/existing"]
        for name, (service, target) in kb.TARGETS.items():
            state[service]["Mounts"].append({"Destination": target, "Type": "volume", "Name": name})
        image = {"Id": "sha256:" + "a" * 64, "Os": "linux", "Architecture": "amd64", "RepoDigests": ["image@sha256:" + "b" * 64]}
        def run(args, **kwargs):
            if args[:3] == ["docker", "image", "inspect"]:
                return json.dumps([image]).encode()
            if args[:2] == ["docker", "cp"]:
                pathlib.Path(args[-1]).write_text('{}' if args[-1].endswith('rag.json') else 'system prompt')
            if kwargs.get("stdout"):
                if "mysqldump" in str(args):
                    kwargs["stdout"].write(b"-- complete SQL fixture\n")
                else:
                    with tarfile.open(fileobj=kwargs["stdout"], mode="w") as archive:
                        item = tarfile.TarInfo("document.txt")
                        item.size = 5
                        archive.addfile(item, io.BytesIO(b"ready"))
            return b""
        with patch.object(kb, "STORE", self.root), patch.object(kb, "source_state", return_value=state), \
             patch.object(kb, "run", side_effect=run) as command, patch.object(kb, "vector_counts", return_value={}), \
             patch.object(kb, "http_json", return_value={"models": []}), patch.object(kb, "resume_sources"), \
             patch.object(kb, "mysql", return_value=b"0"), patch.object(kb, "inventory", return_value={"documents": 3}):
            output = self.root / "standard.akb.tar"
            kb.backup(output)
            with tarfile.open(output) as archive:
                self.assertEqual(set(archive.getnames()), kb.DATA_FILES | {"manifest.json"})
                self.assertEqual(json.load(archive.extractfile("manifest.json"))["mode"], "standard")
            commands = [call.args[0] for call in command.call_args_list]
            self.assertNotIn(["docker", "stop", "--time", "120", "ollama"], commands)
            self.assertFalse(any(args[:3] == ["docker", "image", "save"] for args in commands))
            self.assertFalse(any("ollama:ro" in args for args in commands))


if __name__ == "__main__":
    unittest.main()
