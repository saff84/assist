#!/usr/bin/env bash
# Read-only audit of the actual Ubuntu host and locally installed container images.
set -euo pipefail
umask 077
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$project_dir"
source scripts/active-compose-env.sh
audit_dir=${AUDIT_DIR:-"$project_dir/.security-reports/$(date -u +%Y%m%dT%H%M%SZ)"}
mkdir -p "$audit_dir/tools"
audit_dir=$(cd "$audit_dir" && pwd -P)
for command in docker curl tar sha256sum python3; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
if [ "$(id -u)" -ne 0 ]; then
  printf 'Run with sudo to inspect installed OS packages and Docker.\n' >&2
  exit 1
fi
trivy_version=0.76.1
case "$(uname -m)" in
  x86_64) trivy_arch=64bit ;;
  aarch64|arm64) trivy_arch=ARM64 ;;
  *) printf 'Unsupported architecture\n' >&2; exit 1 ;;
esac
archive="trivy_${trivy_version}_Linux-${trivy_arch}.tar.gz"
release="https://github.com/aquasecurity/trivy/releases/download/v${trivy_version}"
curl --fail --location --retry 3 "$release/$archive" -o "$audit_dir/tools/$archive"
curl --fail --location --retry 3 "$release/trivy_${trivy_version}_checksums.txt" -o "$audit_dir/tools/checksums.txt"
(cd "$audit_dir/tools"; grep -E "[ *]${archive}$" checksums.txt | sha256sum -c -)
tar -xzf "$audit_dir/tools/$archive" -C "$audit_dir/tools" trivy
scanner="$audit_dir/tools/trivy"
export TRIVY_CACHE_DIR="$audit_dir/cache"
cp /etc/os-release "$audit_dir/os-release.txt"
uname -r > "$audit_dir/kernel.txt"
docker version --format '{{json .Server}}' > "$audit_dir/docker-engine.json"
docker info --format '{{json .SecurityOptions}}' > "$audit_dir/docker-security-options.json"
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' > "$audit_dir/container-ports.txt"
dpkg-query -W -f='${Package}\t${Version}\n' > "$audit_dir/ubuntu-packages.txt"
"$scanner" --version > "$audit_dir/trivy-version.txt"
failures=0
for service in app mysql weaviate ollama; do
  container_id=$(docker compose ps -aq "$service")
  if [ -z "$container_id" ]; then
    printf '%s: no container, skipped\n' "$service" >> "$audit_dir/scan-status.txt"
    continue
  fi
  image_id=$(docker inspect --format '{{.Image}}' "$container_id")
  printf '%s %s\n' "$service" "$image_id" >> "$audit_dir/image-ids.txt"
  # Never dump .Config.Env or expanded compose configuration into reports.
  if "$scanner" image --image-src docker --skip-version-check --scanners vuln --pkg-types os,library --timeout 30m --format json --output "$audit_dir/image-$service.json" "$image_id"; then
    printf '%s: scanned\n' "$service" >> "$audit_dir/scan-status.txt"
  else
    failures=$((failures + 1))
    printf '%s: SCAN FAILED\n' "$service" >> "$audit_dir/scan-status.txt"
  fi
done
if "$scanner" rootfs --skip-version-check --scanners vuln --pkg-types os --timeout 30m \
  --skip-dirs /proc,/sys,/dev,/run,/tmp,/var/lib/docker,/var/lib/containerd,"$project_dir" \
  --format json --output "$audit_dir/ubuntu-host.json" /; then
  printf 'Ubuntu host: scanned\n' >> "$audit_dir/scan-status.txt"
else
  failures=$((failures + 1))
  printf 'Ubuntu host: SCAN FAILED\n' >> "$audit_dir/scan-status.txt"
fi
if docker compose exec -T app python3 -c 'import importlib.metadata as m; print("\n".join(sorted({d.metadata["Name"] + "==" + d.version for d in m.distributions() if d.metadata["Name"]})))' > "$audit_dir/python-installed.txt"; then
  if ! grep -q '[^[:space:]]' "$audit_dir/python-installed.txt"; then
    printf 'Python audit: skipped (no installed Python distributions)\n' >> "$audit_dir/scan-status.txt"
  elif python3 -m venv "$audit_dir/python-audit" && \
    "$audit_dir/python-audit/bin/python" -m pip install --disable-pip-version-check 'pip-audit==2.10.1'; then
    # 0 means clean, 1 means findings; neither changes the application environment.
    set +e
    "$audit_dir/python-audit/bin/python" -m pip_audit --disable-pip --no-deps --progress-spinner off \
      -r "$audit_dir/python-installed.txt" --format json --output "$audit_dir/python-installed-audit.json"
    python_status=$?
    set -e
    printf 'Python audit exit code: %s (0=clean, 1=findings; inspect JSON for skipped packages/errors)\n' "$python_status" >> "$audit_dir/scan-status.txt"
    if [ ! -s "$audit_dir/python-installed-audit.json" ] || [ "$python_status" -gt 1 ]; then failures=$((failures + 1)); fi
  else
    failures=$((failures + 1))
    printf 'Python audit: FAILED (install python3-venv and retry)\n' >> "$audit_dir/scan-status.txt"
  fi
elif docker compose exec -T app sh -c '! command -v python3 >/dev/null 2>&1'; then
  printf 'Python audit: skipped (Python is not installed; OCR is disabled)\n' >> "$audit_dir/scan-status.txt"
else
  failures=$((failures + 1))
  printf 'Python inventory: FAILED\n' >> "$audit_dir/scan-status.txt"
fi
printf 'Reports: %s\nIncomplete scans: %s\n' "$audit_dir" "$failures"
exit "$failures"
