#!/usr/bin/env python3
"""Reject changes to existing persistent storage before an application update."""
import json
import pathlib
import subprocess
import sys

MOUNTS = {"app": "/app/uploads", "mysql": "/var/lib/mysql",
          "weaviate": "/var/lib/weaviate", "ollama": "/root/.ollama"}


def validate_inventory(before, after):
    expected = {"documents", "document_chunks", "sections", "products", "manual_regions",
                "product_groups", "product_items", "document_annotations", "faq_entries"}
    if set(before) != expected or set(after) != expected:
        raise ValueError("Document inventory is incomplete")
    if any(count < 0 or after[table] < count for table, count in before.items()):
        raise ValueError("Document inventory decreased: investigate before accepting update; backups preserved")


def validate_storage(config, containers):
    for service, target in MOUNTS.items():
        actual = containers[service]
        if not actual["State"].get("Running"):
            raise ValueError(f"{service}: existing container must be running")
        expected_mounts = [m for m in config["services"][service].get("volumes", []) if m["target"] == target]
        actual_mounts = [m for m in actual.get("Mounts", []) if m["Destination"] == target]
        if len(expected_mounts) != 1 or len(actual_mounts) != 1:
            raise ValueError(f"{service}: required persistent mount is missing or ambiguous")
        expected, mounted = expected_mounts[0], actual_mounts[0]
        kind = expected["type"]
        if kind == "volume":
            source = config["volumes"][expected["source"]]["name"]
            actual_source = mounted.get("Name")
        elif kind == "bind":
            source, actual_source = expected["source"], mounted.get("Source")
        else:
            raise ValueError(f"{service}: unsupported persistent mount type")
        if kind != mounted["Type"] or source != actual_source:
            raise ValueError(f"{service}: persistent storage would change; update stopped")
        if expected.get("read_only") or not mounted.get("RW", True):
            raise ValueError(f"{service}: persistent storage must remain writable")
    # Secrets remain in memory and are never printed.
    for service, keys in {
        "app": ["DATABASE_URL"],
        "mysql": ["MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD"],
    }.items():
        old_env = dict(item.split("=", 1) for item in containers[service]["Config"].get("Env", []) if "=" in item)
        new_env = config["services"][service].get("environment", {})
        for key in keys:
            if not old_env.get(key) or old_env[key] != new_env.get(key):
                raise ValueError(f"{service}: {key} differs from the running container; update stopped")
    app_env = config["services"]["app"].get("environment", {})
    if str(app_env.get("DB_SCHEMA_BOOTSTRAP", "false")).lower() == "true":
        raise ValueError("DB_SCHEMA_BOOTSTRAP=true is not allowed for this production update")


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--inventory":
        root = pathlib.Path(sys.argv[2])
        def counts(name):
            return dict((key, int(value)) for key, value in (line.split("\t") for line in (root / name).read_text().splitlines()))
        validate_inventory(counts("document-counts-before.tsv"), counts("document-counts-after.tsv"))
        print("Document inventory: no decrease in stored records")
        return
    config = json.load(sys.stdin)
    containers = {}
    for service in MOUNTS:
        ids = subprocess.check_output(["docker", "compose", "ps", "-q", service], text=True).split()
        if len(ids) != 1:
            raise ValueError(f"{service}: expected exactly one existing running container")
        containers[service] = json.loads(subprocess.check_output(["docker", "inspect", ids[0]], text=True))[0]
    validate_storage(config, containers)
    print("Storage preflight: existing uploads, MySQL, Weaviate and Ollama storage/settings preserved")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f"Storage preflight failed: {error}", file=sys.stderr)
        sys.exit(1)
