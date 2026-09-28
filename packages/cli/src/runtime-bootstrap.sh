#!/bin/sh
# This entry point intentionally needs no JavaScript runtime or package manager.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "$#" -gt 0 ] || { echo 'Usage: runtime-bootstrap.sh <JavaScript entry> [arguments...]' >&2; exit 2; }
entry=$1
shift
case $(uname -s) in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo 'Use runtime-bootstrap.ps1 on Windows.' >&2; exit 1 ;; esac
case $(uname -m) in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Unsupported runtime architecture.' >&2; exit 1 ;; esac
cache=${SPARK_HOME:-"$HOME/.spark"}/tooling/runtimes

compatible() {
  [ -f "$1" ] && [ -x "$1" ] && "$1" "$here/js-runtime.cjs" "${2:-}" >/dev/null 2>&1
}
launch() {
  runtime_path=$1
  shift
  SPARK_JS_RUNTIME=$runtime_path
  export SPARK_JS_RUNTIME
  PATH="$(dirname -- "$runtime_path"):$PATH"
  export PATH
  exec "$runtime_path" "$entry" "$@"
}
asset() {
  row=$(awk -F '\t' -v kind="$1" -v platform="$platform" -v arch="$arch" '$1 == kind && $3 == platform && $4 == arch { print }' "$here/runtime-downloads.tsv")
  [ -n "$row" ] || return 1
  read -r kind version target cpu url checksum relative <<EOF
$row
EOF
  destination="$cache/$kind-$version-$target-$cpu-$checksum"
  runtime_path="$destination/$relative"
}
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}
cached() {
  [ -f "$runtime_path" ] && [ -f "$destination/.binary-sha256" ] &&
    [ "$(sha256 "$runtime_path")" = "$(cat "$destination/.binary-sha256")" ] && compatible "$runtime_path"
}

requested=${SPARK_JS_RUNTIME:-}
case "$requested" in
  '') choices='node bun' ;;
  node|bun) choices=$requested ;;
  *) compatible "$requested" || { echo "Unsupported or missing runtime: $requested" >&2; exit 1; }
     launch "$requested" "$@" ;;
esac
for kind in $choices; do
  candidate=$(command -v "$kind" || true)
  if [ -n "$candidate" ] && compatible "$candidate" "$requested"; then launch "$candidate" "$@"; fi
done
for kind in $choices; do
  if asset "$kind" && cached; then launch "$runtime_path" "$@"; fi
done
download=${requested:-${SPARK_RUNTIME_DOWNLOAD:-node}}
case "$download" in node|bun) ;; *) echo 'SPARK_RUNTIME_DOWNLOAD must be node or bun.' >&2; exit 2 ;; esac
asset "$download" || { echo "No pinned $download download for $platform/$arch. Install a compatible runtime manually." >&2; exit 1; }
mkdir -p "$cache"
lock="$destination.lock"
owned=0
staging=''
cleanup() {
  [ -z "$staging" ] || rm -rf -- "$staging"
  [ "$owned" = 0 ] || rm -rf -- "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
attempt=0
until mkdir "$lock" 2>/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || { echo "Another process is installing $download; retry shortly." >&2; exit 1; }
  if [ -f "$lock/pid" ]; then
    pid=$(cat "$lock/pid" 2>/dev/null || true)
    # Do not reap here: another waiter could acquire a new lock between a
    # stale-owner check and removal. Normal failures/signals use the trap above.
    case "$pid" in ''|*[!0-9]*) ;; *) if ! kill -0 "$pid" 2>/dev/null; then
      echo "Interrupted runtime installation. Remove $lock and retry." >&2
      exit 1
    fi ;; esac
  fi
  sleep 1
done
owned=1
echo "$$" > "$lock/pid"
if ! cached; then
  staging=$(mktemp -d "$cache/.install-$download-XXXXXX")
  archive="$staging/archive"
  echo "Downloading Spark's private $kind $version runtime…" >&2
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 300 --max-filesize 134217728 --output "$archive" "$url"
  [ "$(sha256 "$archive")" = "$checksum" ] || { echo 'Runtime download checksum mismatch.' >&2; exit 1; }
  mkdir "$staging/unpacked"
  case "$url" in
    *.zip) unzip -q "$archive" -d "$staging/unpacked" ;;
    *.tar.gz) tar -xzf "$archive" -C "$staging/unpacked" ;;
    *) echo 'Unsupported runtime archive.' >&2; exit 1 ;;
  esac
  compatible "$staging/unpacked/$relative" || { echo 'Downloaded runtime cannot run on this machine.' >&2; exit 1; }
  sha256 "$staging/unpacked/$relative" > "$staging/unpacked/.binary-sha256"
  # The lock owns this versioned cache entry. Publish only verified complete files.
  [ ! -e "$destination" ] || rm -rf -- "$destination"
  mv "$staging/unpacked" "$destination"
fi
cleanup
owned=0
staging=''
trap - EXIT INT TERM
launch "$runtime_path" "$@"
