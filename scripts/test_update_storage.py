import copy
import unittest
from check_update_storage import MOUNTS, validate_storage, validate_inventory


def fixture():
    config = {"services": {}, "volumes": {}}
    containers = {}
    for service, target in MOUNTS.items():
        config["volumes"][service] = {"name": f"assist_{service}"}
        config["services"][service] = {
            "volumes": [{"type": "volume", "source": service, "target": target}],
            "environment": {},
        }
        containers[service] = {
            "State": {"Running": True},
            "Mounts": [{"Type": "volume", "Name": f"assist_{service}", "Destination": target, "RW": True}],
            "Config": {"Env": []},
        }
    for service, env in {
        "app": {"DATABASE_URL": "mysql://user:fixture@mysql:3306/existing"},
        "mysql": {"MYSQL_DATABASE": "existing", "MYSQL_USER": "user", "MYSQL_PASSWORD": "fixture", "MYSQL_ROOT_PASSWORD": "fixture-root"},
    }.items():
        config["services"][service]["environment"] = env
        containers[service]["Config"]["Env"] = [f"{key}={value}" for key, value in env.items()]
    return config, containers


class StorageTests(unittest.TestCase):
    def test_document_inventory_accepts_existing_records_and_additions(self):
        before = dict.fromkeys(["documents", "document_chunks", "sections", "products", "manual_regions", "product_groups", "product_items", "document_annotations", "faq_entries"], 100)
        validate_inventory(before, before)
        validate_inventory(before, {**before, "documents": 101})
        with self.assertRaisesRegex(ValueError, "decreased"):
            validate_inventory(before, {**before, "document_chunks": 99})
        with self.assertRaisesRegex(ValueError, "incomplete"):
            validate_inventory(before, {"documents": 100})

    def test_existing_storage_is_accepted(self):
        validate_storage(*fixture())

    def test_each_changed_volume_is_rejected(self):
        for service in MOUNTS:
            with self.subTest(service=service):
                config, containers = fixture()
                config["volumes"][service]["name"] = "different_project_volume"
                with self.assertRaisesRegex(ValueError, "storage would change"):
                    validate_storage(config, containers)

    def test_changed_database_and_credentials_are_rejected_without_logging_values(self):
        config, containers = fixture()
        for service in ["app", "mysql"]:
            for key in config["services"][service]["environment"]:
                changed = copy.deepcopy(config)
                changed["services"][service]["environment"][key] = "DO_NOT_PRINT_THIS_SECRET"
                with self.assertRaises(ValueError) as error:
                    validate_storage(changed, containers)
                self.assertNotIn("DO_NOT_PRINT_THIS_SECRET", str(error.exception))

    def test_missing_mount_is_rejected(self):
        config, containers = fixture()
        containers["app"]["Mounts"] = []
        with self.assertRaisesRegex(ValueError, "missing"):
            validate_storage(config, containers)

    def test_readonly_uploads_are_rejected(self):
        config, containers = fixture()
        config["services"]["app"]["volumes"][0]["read_only"] = True
        with self.assertRaisesRegex(ValueError, "writable"):
            validate_storage(config, containers)

    def test_changed_mount_type_is_rejected(self):
        config, containers = fixture()
        config["services"]["app"]["volumes"][0].update(type="bind", source="/new/uploads")
        with self.assertRaisesRegex(ValueError, "storage would change"):
            validate_storage(config, containers)

    def test_existing_bind_mount_is_accepted(self):
        config, containers = fixture()
        config["services"]["app"]["volumes"][0].update(type="bind", source="/existing/uploads")
        containers["app"]["Mounts"][0].update(Type="bind", Source="/existing/uploads")
        validate_storage(config, containers)

    def test_stopped_database_is_rejected(self):
        config, containers = fixture()
        containers["mysql"]["State"]["Running"] = False
        with self.assertRaisesRegex(ValueError, "running"):
            validate_storage(config, containers)

    def test_schema_bootstrap_is_rejected(self):
        config, containers = fixture()
        config["services"]["app"]["environment"]["DB_SCHEMA_BOOTSTRAP"] = "true"
        with self.assertRaisesRegex(ValueError, "DB_SCHEMA_BOOTSTRAP"):
            validate_storage(config, containers)


if __name__ == "__main__":
    unittest.main()
