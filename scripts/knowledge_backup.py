#!/usr/bin/env python3
"""Offline-consistent knowledge backup and isolated restore. Python stdlib + Docker."""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import secrets
import signal
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / ".knowledge-backups"
ACTIVE = ROOT / ".knowledge-active.json"
SERVICES = ("mysql", "weaviate", "ollama", "app")
TARGETS = {"uploads": ("app", "/app/uploads"), "weaviate": ("weaviate", "/var/lib/weaviate"),
           "ollama": ("ollama", "/root/.ollama")}
PORTABLE_ENV = ("LLM_MODEL_GENERATION", "OLLAMA_MODEL", "EMBEDDING_MODEL", "OLLAMA_EMBEDDING_MODEL",
                "RERANK_MODEL", "RERANK_ENABLED", "RAG_RERANK_ENABLED", "LLM_TEMPERATURE", "LLM_TOP_P",
                "LLM_REPEAT_PENALTY", "COMPANY_FULL_MD_MAX_TOKENS")
DATA_FILES = {"database.sql", "uploads.tar", "weaviate.tar", "rag.json", "system-prompt.txt", "uploads-inventory.json"}
FILES = DATA_FILES | {"ollama.tar", "images.tar"}  # Legacy format 1 / full offline archive.


def payload_files(manifest):
    if manifest.get("format") == 1:
        return FILES
    if manifest.get("format") == 2 and manifest.get("mode") in ("standard", "full"):
        return FILES if manifest["mode"] == "full" else DATA_FILES
    raise Failure("Unsupported backup format/mode")

VERIFY_FILES_NODE = '''const fs=require('fs'),path=require('path'),crypto=require('crypto');
try {const c=JSON.parse(fs.readFileSync(0,'utf8')), root=path.resolve(c.root);
for(const [name,item] of Object.entries(c.files)) {
 const p=path.resolve(root,name);
 if(!p.startsWith(root+path.sep)||!fs.lstatSync(p).isFile()) throw Error('path');
 const fd=fs.openSync(p,'r'), h=crypto.createHash('sha256'), buf=Buffer.alloc(1048576);let size=0,n;
 try {while((n=fs.readSync(fd,buf,0,buf.length,null))>0){h.update(buf.subarray(0,n));size+=n;}}finally{fs.closeSync(fd);}
 if(size!==item.size||h.digest('hex')!==item.sha256) throw Error('checksum');
}process.stdout.write('All document/attachment file checksums match');}catch{process.exit(1);}'''


class Failure(RuntimeError):
    pass


def run(args, *, data=None, stdout=None):
    result = subprocess.run([str(x) for x in args], input=data, stdout=stdout or subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if result.returncode:
        # Never include expanded environment, SQL, credentials or inspect output in errors.
        raise Failure(f"{args[0]} operation failed (exit {result.returncode}); no working storage was overwritten")
    return result.stdout


def compose_args(file=None):
    if file is None and ACTIVE.exists():
        file = json.loads(ACTIVE.read_text())["compose"]
    return ["docker", "compose", "--project-directory", str(ROOT)] + (["-f", str(file)] if file else [])


def compose(*args, file=None, **kwargs):
    return run(compose_args(file) + list(args), **kwargs)


def inspect(container):
    return json.loads(run(["docker", "inspect", container]))[0]


def env_of(container):
    return dict(item.split("=", 1) for item in container["Config"].get("Env", []) if "=" in item)


def private_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + ".tmp-" + secrets.token_hex(4))
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


@contextlib.contextmanager
def operation_lock():
    # On the Ubuntu/Docker host only. The same lock is used by backup/restore/promote.
    import fcntl
    STORE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STORE / "operation.lock", "a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Failure("Another knowledge operation is running") from error
        yield


def mysql(container, sql, output=None):
    command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot --binary-mode --default-character-set=utf8mb4 -N -B "$MYSQL_DATABASE"'
    return run(["docker", "exec", "-i", container, "sh", "-ec", command],
               data=sql.encode() if isinstance(sql, str) else sql, stdout=output)


def inventory(container):
    tables = mysql(container, "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name;").decode().splitlines()
    if not {"documents", "document_chunks", "users"}.issubset(tables):
        raise Failure("This is not a complete assistant database")
    counts = {}
    for table in tables:
        identifier = table.replace("`", "``")
        counts[table] = int(mysql(container, f"SELECT COUNT(*) FROM `{identifier}`;").decode().strip())
    return counts


def http_json(app, url, method="GET", body=None, timeout=180, allow_missing=False):
    script = '''const fs=require('fs'); const c=JSON.parse(fs.readFileSync(0,'utf8'));
fetch(c.url,{method:c.method,headers:{'Content-Type':'application/json'},
body:c.body===null?undefined:JSON.stringify(c.body),signal:AbortSignal.timeout(c.timeout*1000)})
.then(async r=>{if(c.allowMissing&&(r.status===404||(r.ok&&(r.headers.get('content-type')||'').includes('text/html')))){
 process.stdout.write(JSON.stringify({__knowledgeMissingEndpoint:true}));return;}
 if(!r.ok)throw Error('HTTP '+r.status);process.stdout.write(JSON.stringify(await r.json()))})
.catch(()=>process.exit(1));'''
    command = (["docker", "run", "--rm", "-i", "--network", app[1], "--entrypoint", "node", app[0]]
               if isinstance(app, tuple) else ["docker", "exec", "-i", app, "node"])
    result = json.loads(run(command + ["-e", script],
                            data=json.dumps(dict(url=url, method=method, body=body, timeout=timeout, allowMissing=allow_missing)).encode()))
    return None if allow_missing and result.get("__knowledgeMissingEndpoint") else result


def vector_counts(app):
    schema = http_json(app, "http://weaviate:8080/v1/schema", timeout=30)
    result = {}
    for item in schema.get("classes", []):
        name = item["class"]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise Failure("Unsupported Weaviate class name")
        response = http_json(app, "http://weaviate:8080/v1/graphql", "POST",
                             {"query": "{Aggregate{" + name + "{meta{count}}}}"}, 60)
        if response.get("errors"):
            raise Failure("Weaviate inventory failed")
        result[name] = response["data"]["Aggregate"][name][0]["meta"]["count"]
    return result


def wait_ready(container, seconds=240):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        state = inspect(container)["State"]
        if state.get("Running") and state.get("Health", {}).get("Status", "healthy") == "healthy":
            return
        time.sleep(2)
    raise Failure("Container did not become healthy; original storage is retained")


def safe_volume_tar(path):
    # No links/devices/escape paths may be imported into a volume. Scans without extracting.
    with tarfile.open(path, "r:") as archive:
        for member in archive:
            parts = pathlib.PurePosixPath(member.name).parts
            if member.name.startswith("/") or ".." in parts or "\\" in member.name:
                raise Failure("Unsafe path inside volume archive")
            if not (member.isfile() or member.isdir()):
                raise Failure("Links/devices in volume archive are not supported")


def uploads_inventory(path):
    result = {}
    with tarfile.open(path, "r:") as archive:
        for member in archive:
            if not member.isfile():
                continue
            name = str(pathlib.PurePosixPath(member.name))
            if name in result:
                raise Failure("Duplicate document file in uploads archive")
            digest = hashlib.sha256()
            with archive.extractfile(member) as stream:
                for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
                    digest.update(block)
            result[name] = {"size": member.size, "sha256": digest.hexdigest()}
    return result


def verify_archive(path, destination):
    """Extract only known regular payloads; reject duplicates, links and traversal."""
    destination = pathlib.Path(destination)
    with tarfile.open(path, "r:") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)) or "manifest.json" not in names:
            raise Failure("Archive has missing, duplicate or unexpected entries")
        if any(not member.isfile() or member.size < 0 for member in members):
            raise Failure("Archive entries must be regular files")
        metadata = archive.getmember("manifest.json")
        if metadata.size > 1024 * 1024:
            raise Failure("Oversized backup manifest")
        manifest = json.load(archive.extractfile(metadata))
        expected_files = payload_files(manifest)
        if set(names) != expected_files | {"manifest.json"} or set(manifest.get("files", {})) != expected_files:
            raise Failure("Archive has missing or unexpected payloads")
        if set(manifest.get("images", {})) != set(SERVICES):
            raise Failure("Backup does not contain all service images")
        if set(manifest.get("ragEnvironment", {})) - set(PORTABLE_ENV):
            raise Failure("Unexpected environment settings in backup")
        required = sum(member.size for member in members)
        if shutil.disk_usage(destination).free < required + 256 * 1024 * 1024:
            raise Failure("Insufficient space to verify/extract backup")
        for member in members:
            target = destination / member.name
            with archive.extractfile(member) as source, open(target, "xb") as output:
                shutil.copyfileobj(source, output, 4 * 1024 * 1024)
            target.chmod(0o600)
            if member.name != "manifest.json":
                expected = manifest["files"][member.name]
                if target.stat().st_size != expected["size"] or sha(target) != expected["sha256"]:
                    raise Failure(f"Backup checksum mismatch: {member.name}")
    for name in ("uploads", "weaviate", "ollama"):
        if f"{name}.tar" in expected_files:
            safe_volume_tar(destination / f"{name}.tar")
    return manifest


def source_state():
    state = {}
    for service in SERVICES:
        ids = compose("ps", "-q", service).decode().split()
        if len(ids) != 1:
            raise Failure(f"Expected one running {service} container")
        state[service] = inspect(ids[0])
        if not state[service]["State"]["Running"]:
            raise Failure(f"{service} is not running")
    return state


def resume_sources(state, stopped):
    failed = []
    for service in ("weaviate", "ollama", "app"):
        if service in stopped:
            try:
                run(["docker", "start", state[service]["Id"]])
                wait_ready(state[service]["Id"])
            except Failure:
                failed.append(service)
    if failed:
        raise Failure("Backup recovery needs attention: failed to resume " + ", ".join(failed))


def backup(output, mode="standard"):
    output = pathlib.Path(output).resolve()
    if output.exists() or pathlib.Path(str(output) + ".sha256").exists():
        raise Failure("Backup destination already exists")
    output.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    state = source_state()
    app = state["app"]["Id"]
    app_image = state["app"]["Image"]
    app_env = env_of(state["app"])
    networks = list(state["app"]["NetworkSettings"]["Networks"])
    if len(networks) != 1:
        raise Failure("Backup supports the single-network Compose deployment only")
    probe = (app_image, networks[0])
    if env_of(state["weaviate"]).get("AUTHENTICATION_APIKEY_ENABLED", "false").lower() != "false":
        raise Failure("API-key protected Weaviate needs a separately configured backup adapter")
    ollama_url = app_env.get("OLLAMA_URL") or app_env.get("OLLAMA_BASE_URL") or "http://ollama:11434"
    if ollama_url.rstrip("/") != "http://ollama:11434" or app_env.get("WEAVIATE_URL", "http://weaviate:8080").rstrip("/") != "http://weaviate:8080":
        raise Failure("Only the local Compose Ollama/Weaviate deployment is supported")
    database_url = urllib.parse.urlsplit(app_env.get("DATABASE_URL", ""))
    database = env_of(state["mysql"])["MYSQL_DATABASE"]
    if database_url.scheme != "mysql" or database_url.hostname != "mysql" or database_url.port not in (None, 3306) or urllib.parse.unquote(database_url.path.lstrip("/")) != database:
        raise Failure("App database does not match the MySQL service being backed up")
    ollama_env = env_of(state["ollama"])
    models_directory = ollama_env.get("OLLAMA_MODELS") or ollama_env.get("HOME", "/root") + "/.ollama/models"
    if models_directory != "/root/.ollama/models" or env_of(state["weaviate"]).get("PERSISTENCE_DATA_PATH", "/var/lib/weaviate") != "/var/lib/weaviate":
        raise Failure("Nonstandard model/vector storage needs a separately configured adapter")
    # Exclude .env entirely. Only an explicit model/retrieval allowlist is portable.
    manifest = {"format": 2, "mode": mode, "createdUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "database": env_of(state["mysql"])["MYSQL_DATABASE"],
                "ragEnvironment": {key: app_env[key] for key in PORTABLE_ENV if key in app_env},
                "weaviateHostname": state["weaviate"]["Config"]["Hostname"],
                "images": {}, "files": {}}
    for service in SERVICES:
        image = json.loads(run(["docker", "image", "inspect", state[service]["Image"]]))[0]
        manifest["images"][service] = {"id": image["Id"], "os": image["Os"], "architecture": image["Architecture"],
                                        "repoDigests": image.get("RepoDigests") or []}
        if mode == "standard" and not manifest["images"][service]["repoDigests"]:
            print(f"Note: {service} has no registry digest. Keep its exact local image or a separate full backup for disaster recovery.", flush=True)
    for name, (service, target) in TARGETS.items():
        mounts = [m for m in state[service]["Mounts"] if m["Destination"] == target]
        if len(mounts) != 1 or mounts[0]["Type"] not in ("bind", "volume"):
            raise Failure(f"Persistent {name} mount is missing")
        if mounts[0]["Type"] == "volume":
            users = run(["docker", "ps", "-q", "--filter", "volume=" + mounts[0]["Name"]]).decode().split()
            allowed = {item["Id"][:12] for item in state.values()}
            if any(user[:12] not in allowed for user in users):
                raise Failure(f"Other running containers use {name}; stop external writers first")
    with tempfile.TemporaryDirectory(prefix="backup-", dir=STORE) as temporary:
        work = pathlib.Path(temporary)
        files = payload_files(manifest)
        if mode == "full":
            print("Saving exact application/database images before maintenance...", flush=True)
            with open(work / "images.tar", "wb") as stream:
                run(["docker", "image", "save", *sorted({s["Image"] for s in state.values()})], stdout=stream)
        else:
            print("Standard backup: Docker images and Ollama model files are excluded.", flush=True)
        stopped = []
        try:
            # Arm recovery before stop, so an interrupted stop is recoverable.
            paused = ("app", "weaviate", "ollama") if mode == "full" else ("app", "weaviate")
            print("Maintenance: pausing " + ", ".join(paused) + " for a consistent snapshot...", flush=True)
            for service in paused:
                stopped.append(service)
                run(["docker", "stop", "--time", "120", state[service]["Id"]])
                if service == "app":
                    # Capture inventories/config while all application writers are paused,
                    # before shutting down the services whose volumes will be copied.
                    manifest["vectors"] = vector_counts(probe)
                    manifest["models"] = http_json(probe, "http://ollama:11434/api/tags")["models"]
                    for filename, key, default in (("rag.json", "RAG_CONFIG_PATH", "/app/config/rag.json"),
                                                   ("system-prompt.txt", "RAG_SYSTEM_PROMPT_PATH", "/app/prompts/system.sanext.txt")):
                        source = app_env.get(key) or default
                        if not source.startswith("/"):
                            source = "/app/" + source.removeprefix("./")
                        run(["docker", "cp", f"{app}:{source}", str(work / filename)])
            mysql_id = state["mysql"]["Id"]
            nontransactional = mysql(mysql_id, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND engine<>'InnoDB';")
            if int(nontransactional.decode().strip()):
                raise Failure("Non-InnoDB tables need a different consistent backup procedure")
            manifest["counts"] = inventory(mysql_id)
            dimension = mysql(mysql_id, "SELECT JSON_LENGTH(embedding) FROM document_chunks WHERE embedding IS NOT NULL AND JSON_VALID(embedding) LIMIT 1;").decode().strip()
            manifest["embeddingDimension"] = int(dimension) if dimension else None
            with open(work / "database.sql", "wb") as stream:
                run(["docker", "exec", mysql_id, "sh", "-ec", 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -uroot --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4 "$MYSQL_DATABASE"'], stdout=stream)
            for name, (service, target) in TARGETS.items():
                if name == "ollama" and mode != "full":
                    continue
                with open(work / f"{name}.tar", "wb") as stream:
                    run(["docker", "run", "--rm", "--network", "none", "--read-only", "--volumes-from",
                         state[service]["Id"] + ":ro", "--entrypoint", "tar", app_image, "-C", target, "-cpf", "-", "."], stdout=stream)
        finally:
            # Start dependencies first and only then resume requests.
            resume_sources(state, stopped)
        for name in ("uploads", "weaviate", "ollama"):
            if f"{name}.tar" in files:
                safe_volume_tar(work / f"{name}.tar")
        private_json(work / "uploads-inventory.json", uploads_inventory(work / "uploads.tar"))
        if not (work / "database.sql").stat().st_size:
            raise Failure("Empty database dump")
        for name in files:
            manifest["files"][name] = {"size": (work / name).stat().st_size, "sha256": sha(work / name)}
        private_json(work / "manifest.json", manifest)
        partial = pathlib.Path(str(output) + ".partial")
        with open(partial, "xb") as stream, tarfile.open(fileobj=stream, mode="w") as archive:
            for name in sorted(files | {"manifest.json"}):
                archive.add(work / name, arcname=name, recursive=False)
        # Atomically publish without replacing an archive created in the meantime.
        os.link(partial, output)
        partial.unlink()
        with open(str(output) + ".sha256", "x", encoding="ascii") as checksum:
            checksum.write(sha(output) + "  " + output.name + "\n")
    print(f"Complete backup: {output}")


def restore_spec(manifest, images, identifier, stage_port, app_env, directory):
    if not re.fullmatch(r"[A-Za-z0-9_]+", manifest["database"]):
        raise Failure("Unsupported database name")
    if set(manifest["ragEnvironment"]) - set(PORTABLE_ENV):
        raise Failure("Unexpected environment settings in backup")
    password = secrets.token_urlsafe(32)
    env = dict(app_env)
    for key in PORTABLE_ENV:
        env.pop(key, None)
    env.update(manifest["ragEnvironment"])
    env.update(DATABASE_URL=f"mysql://assistant:{password}@mysql:3306/{manifest['database']}",
               NODE_ENV="production", PORT="3000", OLLAMA_URL="http://ollama:11434",
               OLLAMA_BASE_URL="http://ollama:11434", WEAVIATE_URL="http://weaviate:8080",
               SANEXT_SYNC_DISABLED="true", RUN_DB_MIGRATIONS="true", MIGRATIONS_FAIL_OPEN="false", DB_SCHEMA_BOOTSTRAP="false",
               RAG_CONFIG_PATH="/knowledge-runtime/rag.json", RAG_SYSTEM_PROMPT_PATH="/knowledge-runtime/system-prompt.txt")
    if not env.get("JWT_SECRET"):
        env["JWT_SECRET"] = secrets.token_urlsafe(48)
    spec = {"name": "assist_kb_" + identifier, "services": {}, "volumes": {}, "networks": {"default": {}}}
    mounts = {"mysql": ("mysql", "/var/lib/mysql"), "weaviate": ("weaviate", "/var/lib/weaviate"),
              "ollama": ("ollama", "/root/.ollama"), "app": ("uploads", "/app/uploads")}
    for service in SERVICES:
        name, target = mounts[service]
        volume = f"assist_kb_{identifier}_{name}"
        spec["volumes"][name] = {"name": volume, "external": True}
        spec["services"][service] = {"image": images[service], "pull_policy": "never", "restart": "unless-stopped",
                                     "volumes": [{"type": "volume", "source": name, "target": target}], "environment": {}}
    spec["services"]["mysql"]["environment"] = {"MYSQL_ROOT_PASSWORD": secrets.token_urlsafe(32),
        "MYSQL_DATABASE": manifest["database"], "MYSQL_USER": "assistant", "MYSQL_PASSWORD": password}
    spec["services"]["mysql"]["healthcheck"] = {"test": ["CMD", "mysqladmin", "ping", "-h", "localhost"], "interval": "5s", "timeout": "5s", "retries": 60}
    spec["services"]["weaviate"]["environment"] = {"QUERY_DEFAULTS_LIMIT": "25", "AUTHENTICATION_APIKEY_ENABLED": "false", "PERSISTENCE_DATA_PATH": "/var/lib/weaviate"}
    # Preserve the original single-node shard identity for a cold volume restore.
    spec["services"]["weaviate"]["hostname"] = manifest["weaviateHostname"]
    spec["services"]["weaviate"]["healthcheck"] = {"test": ["CMD", "wget", "--spider", "-q", "http://localhost:8080/v1/.well-known/ready"], "interval": "5s", "timeout": "5s", "retries": 120}
    spec["services"]["ollama"].update(environment={"OLLAMA_HOST": "0.0.0.0:11434"}, command=["serve"])
    spec["services"]["ollama"]["healthcheck"] = {"test": ["CMD", "ollama", "list"], "interval": "5s", "timeout": "5s", "retries": 120}
    spec["services"]["app"].update(environment=env, ports=[{"target": 3000, "published": str(stage_port), "host_ip": "127.0.0.1", "protocol": "tcp"}],
        build={"context": str(ROOT), "dockerfile": "Dockerfile"},
        depends_on={service: {"condition": "service_healthy"} for service in ("mysql", "weaviate", "ollama")},
        healthcheck={"test": ["CMD", "node", "-e", 'fetch("http://127.0.0.1:3000/healthz",{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'], "interval": "5s", "timeout": "5s", "retries": 60})
    for filename in ("rag.json", "system-prompt.txt"):
        spec["services"]["app"]["volumes"].append({"type": "bind", "source": str(directory / filename),
            "target": "/knowledge-runtime/" + filename, "read_only": True})
    return spec


def restored_ids(file):
    return {service: compose("ps", "-q", service, file=file).decode().strip() for service in SERVICES}


def question_check(app, question, expected):
    base = "http://127.0.0.1:3000"
    # Older archived app images predate consent routes and return 404 or SPA HTML.
    # Other errors (including 503) still fail verification; never bypass active consent.
    consent = http_json(app, base + "/api/widget/consent", allow_missing=True) or {"enabled": False}
    session = "restore-check-" + secrets.token_hex(12)
    body = {"query": question, "sessionId": session, "includeSources": True}
    if consent.get("enabled"):
        body["consentToken"] = http_json(app, base + "/api/widget/consent/accept", "POST",
                                        {"sessionId": session, "version": consent["version"]})["token"]
    reply = http_json(app, base + "/api/widget/chat", "POST", body, 300)
    if not reply.get("sources") or expected.casefold() not in reply.get("response", "").casefold():
        raise Failure("Control question failed: expected answer with document sources was not obtained")
    return {"question": question, "expected": expected, "sourceCount": len(reply["sources"])}


def check_embedding(app, model, dimension):
    try:
        response = http_json(app, "http://ollama:11434/api/embed", "POST",
                             {"model": model, "input": "knowledge restore verification"}, 300)
        embedding = (response.get("embeddings") or [None])[0]
    except Failure:
        response = http_json(app, "http://ollama:11434/api/embeddings", "POST",
                             {"model": model, "prompt": "knowledge restore verification"}, 300)
        embedding = response.get("embedding")
    if not isinstance(embedding, list) or not embedding or (dimension and len(embedding) != dimension):
        raise Failure("Restored embedding model is unavailable or has the wrong vector dimension")


def resolve_image(service, metadata):
    """Only the exact local image or its immutable registry digest is acceptable."""
    image_id = metadata["id"]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise Failure("Invalid snapshot image identity")
    try:
        actual = json.loads(run(["docker", "image", "inspect", image_id]))[0]
    except Failure:
        actual = None
    if actual is None:
        for digest in metadata.get("repoDigests") or []:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[0-9a-f]{64}", digest):
                raise Failure("Invalid immutable registry image reference")
            try:
                print(f"Downloading the recorded immutable {service} image...", flush=True)
                run(["docker", "image", "pull", digest])
                actual = json.loads(run(["docker", "image", "inspect", image_id]))[0]
                break
            except Failure:
                continue
    if actual is None or actual["Id"] != image_id:
        raise Failure(f"Exact {service} image is unavailable. Install the recorded image/publish it in a registry or use a full backup; latest is not substituted")
    return image_id


def copy_local_models(volume_name, image):
    """Clone cache locally into the NEW volume; never write into the original cache."""
    try:
        ids = compose("ps", "-a", "-q", "ollama").decode().split()
        if len(ids) != 1:
            return False
        container = inspect(ids[0])
    except Failure:
        return False  # Fresh target: models will be downloaded into the isolated copy.
    environment = env_of(container)
    models_path = environment.get("OLLAMA_MODELS") or environment.get("HOME", "/root") + "/.ollama/models"
    mounts = [item for item in container.get("Mounts", []) if item["Destination"] == "/root/.ollama"]
    if models_path != "/root/.ollama/models" or len(mounts) != 1:
        return False
    mount = mounts[0]
    if mount["Type"] not in ("bind", "volume"):
        return False
    source = mount["Name"] if mount["Type"] == "volume" else mount["Source"]
    print("Copying the existing model cache locally into the isolated restore volume...", flush=True)
    script = "const fs=require('fs');if(fs.existsSync('/cache/models'))fs.cpSync('/cache/models','/restore/models',{recursive:true,force:false,errorOnExist:true});"
    run(["docker", "run", "--rm", "--network", "none", "--read-only", "--mount",
         f"type={mount['Type']},src={source},dst=/cache,readonly", "--mount",
         f"type=volume,src={volume_name},dst=/restore", "--entrypoint", "node", image, "-e", script])
    return True


def ensure_models(app, ollama, expected):
    actual = {model["name"]: model["digest"] for model in http_json(app, "http://ollama:11434/api/tags")["models"]}
    for model in expected:
        name, digest = model["name"], model["digest"]
        if actual.get(name) == digest:
            continue
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:-]*", name):
            raise Failure("Invalid recorded model name")
        print(f"Downloading missing/different model into the isolated cache: {name}", flush=True)
        run(["docker", "exec", ollama, "ollama", "pull", name])
        actual = {item["name"]: item["digest"] for item in http_json(app, "http://ollama:11434/api/tags")["models"]}
        if actual.get(name) != digest:
            raise Failure(f"Model {name} does not match the recorded digest. Keep the exact original model or use a full backup; restored embeddings are not rebuilt")
    return actual


def restore(archive, question, expected, port):
    identifier = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S") + secrets.token_hex(3)
    directory = STORE / ("restore-" + identifier)
    directory.mkdir(mode=0o700)
    print("Verifying archive before creating any containers or volumes...", flush=True)
    manifest = verify_archive(archive, directory)
    info = json.loads(run(["docker", "info", "--format", "{{json .}} "]))
    architecture = {"x86_64": "amd64", "aarch64": "arm64"}.get(info["Architecture"], info["Architecture"])
    if any(image["os"] != info["OSType"] or image["architecture"] != architecture for image in manifest["images"].values()):
        raise Failure("Backup image platform differs from target Docker platform")
    # Old/full backups are autonomous; standard backups require exact available images.
    files = payload_files(manifest)
    if "images.tar" in files:
        with open(directory / "images.tar", "rb") as stream:
            result = subprocess.run(["docker", "image", "load"], stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise Failure("Failed to load snapshot images")
    images = {}
    for service in SERVICES:
        image_id = resolve_image(service, manifest["images"][service])
        tag = f"assist-kb-{identifier}-{service}:snapshot"
        run(["docker", "image", "tag", image_id, tag])
        images[service] = tag
    app_env = {}
    if (ROOT / ".env").exists() or ACTIVE.exists():
        target = json.loads(compose("config", "--format", "json"))
        app_env = target["services"]["app"].get("environment", {})
    spec = restore_spec(manifest, images, identifier, port, app_env, directory)
    file = directory / "compose.json"
    private_json(file, spec)
    private_json(directory / "restore-state.json", {"verified": False, "targetSync": app_env.get("SANEXT_SYNC_DISABLED", "false")})
    for key, volume in spec["volumes"].items():
        try:
            run(["docker", "volume", "inspect", volume["name"]])
        except Failure:
            run(["docker", "volume", "create", volume["name"]])
        else:
            raise Failure("Restore volume already exists; refusing to overwrite it")
        if key == "ollama" and "ollama.tar" not in files:
            copy_local_models(volume["name"], images["app"])
        elif key != "mysql":
            with open(directory / f"{key}.tar", "rb") as stream:
                result = subprocess.run(["docker", "run", "--rm", "-i", "--network", "none", "--read-only",
                    "--mount", f"type=volume,src={volume['name']},dst=/restore", "--entrypoint", "tar", images["app"],
                    "-C", "/restore", "-xpf", "-"], stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode:
                raise Failure(f"Failed to import isolated {key} volume")
    try:
        compose("up", "-d", "mysql", "weaviate", "ollama", file=file)
        mysql_id = compose("ps", "-q", "mysql", file=file).decode().strip()
        wait_ready(mysql_id)
        # mysqladmin ping may succeed during the temporary initialization server.
        for attempt in range(120):
            try:
                mysql(mysql_id, "SELECT 1;")
                break
            except Failure:
                if attempt == 119:
                    raise
                time.sleep(2)
        command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot --binary-mode --default-character-set=utf8mb4 "$MYSQL_DATABASE"'
        with open(directory / "database.sql", "rb") as stream:
            result = subprocess.run(["docker", "exec", "-i", mysql_id, "sh", "-ec", command], stdin=stream,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode or inventory(mysql_id) != manifest["counts"]:
            raise Failure("Restored SQL inventory does not match the snapshot")
        compose("up", "-d", "app", file=file)
        ids = restored_ids(file)
        deadline = time.monotonic() + 240
        while True:
            try:
                http_json(ids["app"], "http://127.0.0.1:3000/healthz", timeout=5)
                break
            except Failure:
                if time.monotonic() > deadline:
                    raise Failure("Restored application failed readiness check")
                time.sleep(2)
        run(["docker", "exec", "-i", ids["app"], "node", "-e", VERIFY_FILES_NODE],
            data=json.dumps({"root": "/app/uploads", "files": json.loads((directory / "uploads-inventory.json").read_text())}).encode())
        for attempt in range(120):
            try:
                actual_vectors = vector_counts(ids["app"])
                actual_models = http_json(ids["app"], "http://ollama:11434/api/tags")["models"]
                break
            except Failure:
                if attempt == 119:
                    raise
                time.sleep(2)
        if actual_vectors != manifest["vectors"]:
            raise Failure("Restored vector inventory differs from the snapshot")
        after_start = inventory(mysql_id)
        for table in ("documents", "document_chunks", "manual_regions", "document_annotations", "products", "product_groups", "product_items", "faq_entries"):
            if after_start.get(table) != manifest["counts"].get(table):
                raise Failure("Document data counts changed during restored application startup")
        model_ids = {model["name"]: model["digest"] for model in actual_models}
        if "ollama.tar" not in files:
            model_ids = ensure_models(ids["app"], ids["ollama"], manifest["models"])
        elif model_ids != {model["name"]: model["digest"] for model in manifest["models"]}:
            raise Failure("Restored models differ from the snapshot")
        rag = json.loads((directory / "rag.json").read_text())
        portable = manifest["ragEnvironment"]
        embedding_model = portable.get("EMBEDDING_MODEL") or portable.get("OLLAMA_EMBEDDING_MODEL") or rag.get("retrieval", {}).get("embeddingModel", "bge-m3")
        check_embedding(ids["app"], embedding_model, manifest.get("embeddingDimension"))
        report = question_check(ids["app"], question, expected)
        private_json(directory / "restore-state.json", {"verified": True, "targetSync": app_env.get("SANEXT_SYNC_DISABLED", "false"), "control": report})
    except BaseException:
        with contextlib.suppress(Failure):
            compose("stop", file=file)
        raise
    print(f"Verified isolated assistant: http://127.0.0.1:{port}")
    print(f"Restore directory: {directory}")
    print("Original deployment is unchanged. Use promote with this directory after reviewing the restored assistant.")


def promote(directory, fresh=False, port=3000):
    directory = pathlib.Path(directory).resolve()
    if directory.parent != STORE.resolve() or not directory.name.startswith("restore-"):
        raise Failure("Expected a restore directory created by this tool")
    state_path = directory / "restore-state.json"
    state = json.loads(state_path.read_text())
    if not state.get("verified") or state.get("promoted"):
        raise Failure("Restore must pass checks and must not already be promoted")
    file = directory / "compose.json"
    candidate = json.loads(file.read_text())
    if fresh:
        target = {"services": {"app": {"ports": [{"target": 3000, "published": str(port), "host_ip": "127.0.0.1", "protocol": "tcp"}]}}}
        old_ids = []
        previous_services = {}
    else:
        target = json.loads(compose("config", "--format", "json"))
        previous_services = {key: value["Id"] for key, value in source_state().items()}
        old_ids = [previous_services["app"]]
    ids = restored_ids(file)
    # Re-run the question against the staged copy immediately before switching traffic.
    question_check(ids["app"], state["control"]["question"], state["control"]["expected"])
    if fresh and ACTIVE.exists():
        raise Failure("An active restored deployment exists; do not use --fresh")
    previous = {"appId": old_ids[0] if old_ids else None, "services": previous_services,
                "compose": str(json.loads(ACTIVE.read_text())["compose"]) if ACTIVE.exists() else None,
                "candidatePort": candidate["services"]["app"]["ports"]}
    private_json(directory / "previous.json", previous)
    candidate["services"]["app"]["ports"] = target["services"]["app"].get("ports", [])
    candidate["services"]["app"]["environment"]["SANEXT_SYNC_DISABLED"] = state["targetSync"]
    stopped = False
    try:
        if old_ids:
            stopped = True
            run(["docker", "stop", "--time", "120", old_ids[0]])
        private_json(file, candidate)
        compose("up", "-d", "--no-deps", "app", file=file)
        new_app = restored_ids(file)["app"]
        for attempt in range(90):
            try:
                http_json(new_app, "http://127.0.0.1:3000/healthz", timeout=2)
                break
            except Failure:
                if attempt == 89:
                    raise
                time.sleep(2)
        private_json(ACTIVE, {"compose": str(file)})
        state["promoted"] = True
        private_json(state_path, state)
    except BaseException:
        with contextlib.suppress(Failure):
            compose("stop", "app", file=file)
        if stopped:
            run(["docker", "start", old_ids[0]])
        if previous["compose"]:
            private_json(ACTIVE, {"compose": previous["compose"]})
        elif ACTIVE.exists():
            ACTIVE.unlink()
        state["verified"] = False
        private_json(state_path, state)
        raise
    print("Restored assistant is active on the original app port. Previous DB/files/containers remain available for rollback.")


def rollback(directory):
    directory = pathlib.Path(directory).resolve()
    if directory.parent != STORE.resolve():
        raise Failure("Invalid restore directory")
    state_path = directory / "restore-state.json"
    state = json.loads(state_path.read_text())
    if not state.get("promoted") or not ACTIVE.exists() or pathlib.Path(json.loads(ACTIVE.read_text())["compose"]) != directory / "compose.json":
        raise Failure("This restore is not the active deployment")
    previous = json.loads((directory / "previous.json").read_text())
    compose("stop", "app", file=directory / "compose.json")
    try:
        for service in SERVICES:
            container = previous.get("services", {}).get(service)
            if container:
                run(["docker", "start", container])
                wait_ready(container)
    except BaseException:
        with contextlib.suppress(Failure):
            run(["docker", "stop", previous["appId"]])
        compose("up", "-d", "--no-deps", "app", file=directory / "compose.json")
        raise
    if previous["compose"]:
        private_json(ACTIVE, {"compose": previous["compose"]})
    else:
        ACTIVE.unlink()
    state["promoted"] = False
    state["verified"] = False
    private_json(state_path, state)
    print("Previous deployment resumed. The restored data is retained separately; no databases were overwritten.")


def main():
    os.umask(0o077)
    def interrupt(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    command = sub.add_parser("backup")
    command.add_argument("--output", required=True)
    command.add_argument("--mode", choices=("standard", "full"), default="standard",
                         help="standard excludes model/image bytes; full is an offline autonomous backup")
    command = sub.add_parser("verify")
    command.add_argument("archive")
    command = sub.add_parser("restore")
    command.add_argument("archive")
    command.add_argument("--question", required=True)
    command.add_argument("--expect", required=True)
    command.add_argument("--port", type=int, default=3210)
    command = sub.add_parser("promote")
    command.add_argument("directory")
    command.add_argument("--fresh", action="store_true", help="No previous deployment; bind the restored app to --port")
    command.add_argument("--port", type=int, default=3000)
    sub.add_parser("rollback").add_argument("directory")
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        raise Failure("Run the host tool on Ubuntu/Linux; use the PowerShell transfer scripts from Windows")
    with operation_lock():
        if args.action == "backup":
            backup(args.output, args.mode)
        elif args.action == "verify":
            with tempfile.TemporaryDirectory(dir=STORE) as directory:
                verify_archive(args.archive, directory)
            print("Archive structure and all payload checksums verified")
        elif args.action == "restore":
            if not 1024 <= args.port <= 65535 or not args.question.strip() or not args.expect.strip():
                raise Failure("A valid staging port, control question and expected answer are required")
            restore(args.archive, args.question, args.expect, args.port)
        elif args.action == "promote":
            if not 1024 <= args.port <= 65535:
                raise Failure("Invalid app port")
            promote(args.directory, args.fresh, args.port)
        else:
            rollback(args.directory)


if __name__ == "__main__":
    try:
        main()
    except (Failure, KeyError, ValueError, OSError, tarfile.TarError) as error:
        print(f"Knowledge operation stopped: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Interrupted; recovery handlers ran. Check Docker service status before retrying.", file=sys.stderr)
        sys.exit(130)
