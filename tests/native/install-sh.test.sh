#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd -P)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/destination"
native_os=$(uname -s)
native_arch=$(uname -m)
export REAL_MV
REAL_MV=$(command -v mv)

cat > "$fixture/bin/uname" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  -s) printf '%s\n' "${SCENARIO_OS:-Linux}" ;;
  -m) printf '%s\n' "${SCENARIO_ARCH:-x86_64}" ;;
  *) exit 1 ;;
esac
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
redirects=""
tag="${SCENARIO_TAG:-v1.2.3}"
asset="${SCENARIO_ASSET:-gitten-linux-x64}"
[[ "$1" == -q ]] || exit 2
shift
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -fsS) redirects=disabled ;;
    -fsSL) redirects=enabled ;;
    --proto | --proto-redir) shift ;;
    https://*) url="$1" ;;
  esac
  shift
done
case "$url" in
  https://api.github.com/repos/jmpanozzoz/gitten/releases/latest)
    [[ "$redirects" == disabled ]] || exit 2
    digest="sha256:$(cat "$FIXTURE/manifest-digest")"
    name=SHA256SUMS
    state=uploaded
    case "${SCENARIO:-}" in
      invalid-tag) tag=invalid ;;
      release-offline) exit 1 ;;
      invalid-metadata) printf '{'; exit 0 ;;
      missing-manifest) name=another-asset ;;
      incomplete-manifest) state=starter ;;
      invalid-digest) digest=sha256:000 ;;
    esac
    entry=$(printf '{"name":"%s","state":"%s","digest":"%s"}' "$name" "$state" "$digest")
    if [[ "${SCENARIO:-}" == duplicate-manifest ]]; then entry="$entry,$entry"; fi
    printf '{"tag_name":"%s","assets":[%s]}' "$tag" "$entry"
    ;;
  */releases/download/"$tag"/SHA256SUMS)
    if [[ "${SCENARIO:-}" == manifest-offline ]]; then exit 1; fi
    cp "$FIXTURE/manifest" "$out"
    if [[ "${SCENARIO:-}" == replaced-manifest ]]; then printf '\n' >> "$out"; fi
    ;;
  */releases/download/"$tag"/"$asset")
    if [[ "${SCENARIO:-}" == replaced-manifest ]]; then exit 98; fi
    if [[ "${SCENARIO:-}" == interrupted ]]; then
      printf partial > "$out"
      exit 1
    fi
    cp "$FIXTURE/artifact" "$out"
    ;;
  *) exit 2 ;;
esac
MOCK
cat > "$fixture/bin/mv" <<'MOCK'
#!/usr/bin/env bash
case "${SCENARIO:-}" in
  replace-failed) exit 1 ;;
  interrupt) kill -INT "$PPID"; exit 130 ;;
  terminate) kill -TERM "$PPID"; exit 143 ;;
esac
exec "$REAL_MV" "$@"
MOCK
mkdir "$fixture/common" "$fixture/fallback" "$fixture/primary" "$fixture/no-jq"
for tool in bash awk cat chmod cp find grep jq mkdir mktemp rm; do
  ln -s "$(command -v "$tool")" "$fixture/common/$tool"
  if [[ "$tool" != jq ]]; then ln -s "$fixture/common/$tool" "$fixture/no-jq/$tool"; fi
done
if command -v shasum >/dev/null; then
  ln -s "$(command -v shasum)" "$fixture/fallback/shasum"
else
  export FIXTURE_SHA256SUM
  FIXTURE_SHA256SUM=$(command -v sha256sum)
  cat > "$fixture/fallback/shasum" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1 $2 $3" != '-a 256 --' ]]; then exit 2; fi
exec "$FIXTURE_SHA256SUM" -- "$4"
MOCK
  chmod +x "$fixture/fallback/shasum"
fi
if command -v sha256sum >/dev/null; then
  ln -s "$(command -v sha256sum)" "$fixture/primary/sha256sum"
else
  export FIXTURE_SHASUM
  FIXTURE_SHASUM=$(command -v shasum)
  cat > "$fixture/primary/sha256sum" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" != -- ]]; then exit 2; fi
exec "$FIXTURE_SHASUM" -a 256 -- "$2"
MOCK
  chmod +x "$fixture/primary/sha256sum"
fi
chmod +x "$fixture/bin/"*

export FIXTURE="$fixture"
export GITTEN_INSTALL_DIR="$fixture/destination"
export PATH="$fixture/bin:$PATH"
prev="$fixture/destination/gitten"

write_artifact() {
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$1" > "$fixture/artifact"
}

hash_fixture() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

write_manifest() {
  printf '%s  %s\n' "$(hash_fixture "$fixture/artifact")" "${1:-gitten-linux-x64}" > "$fixture/manifest"
  hash_fixture "$fixture/manifest" > "$fixture/manifest-digest"
}

reject_install() {
  local scenario="$1" reason="$2"
  printf old-installation > "$prev"
  if SCENARIO="$scenario" bash "$root/install.sh" >"$fixture/log" 2>&1; then
    printf 'Unexpected installer success in %s\n' "$scenario" >&2
    exit 1
  fi
  grep -F "$reason" "$fixture/log"
  [[ "$(cat "$prev")" == old-installation ]]
  [[ -z "$(find "$GITTEN_INSTALL_DIR" -name '.gitten-install.*' -print)" ]]
}

write_artifact "gitten v1.2.3"
write_manifest
bash "$root/install.sh" > "$fixture/log"
[[ "$("$prev" --version)" == "gitten v1.2.3" ]]
grep -F "Installed gitten v1.2.3" "$fixture/log"
grep -F "Add " "$fixture/log"
[[ -z "$(find "$GITTEN_INSTALL_DIR" -name '.gitten-install.*' -print)" ]]

reject_install interrupted "Could not download gitten-linux-x64"
PATH="$fixture/bin:$fixture/common:$fixture/primary" bash "$root/install.sh" > "$fixture/log"
[[ "$("$prev" --version)" == "gitten v1.2.3" ]]
PATH="$fixture/bin:$fixture/common:$fixture/fallback" bash "$root/install.sh" > "$fixture/log"
[[ "$("$prev" --version)" == "gitten v1.2.3" ]]
PATH="$fixture/bin:$fixture/common" reject_install missing-checksummer "Install sha256sum or shasum"
PATH="$fixture/bin:$fixture/no-jq" reject_install missing-jq "Install jq to read trusted release metadata"
reject_install release-offline "Could not resolve the latest release"
reject_install invalid-metadata "Invalid release metadata"
reject_install missing-manifest "Missing or ambiguous release manifest metadata"
reject_install incomplete-manifest "Missing or ambiguous release manifest metadata"
reject_install duplicate-manifest "Missing or ambiguous release manifest metadata"
reject_install invalid-digest "Invalid release manifest digest"
reject_install manifest-offline "Could not download release checksums"
reject_install replaced-manifest "checksum mismatch for the release manifest"
reject_install replace-failed "Could not replace"
for pair in 'interrupt 130' 'terminate 143'; do
  scenario=${pair% *}
  expected_code=${pair#* }
  printf old-installation > "$prev"
  code=0
  SCENARIO="$scenario" bash "$root/install.sh" > "$fixture/log" 2>&1 || code=$?
  [[ "$code" == "$expected_code" ]]
  [[ "$(cat "$prev")" == old-installation ]]
  [[ -z "$(find "$GITTEN_INSTALL_DIR" -name '.gitten-install.*' -print)" ]]
done
reject_install invalid-tag "Unexpected release tag"
cp "$fixture/manifest" "$fixture/duplicate"
cat "$fixture/duplicate" >> "$fixture/manifest"
hash_fixture "$fixture/manifest" > "$fixture/manifest-digest"
reject_install duplicate "Missing or ambiguous checksum"
write_manifest another-asset
reject_install missing-hash "Missing or ambiguous checksum"
write_manifest
printf 'corrupted' > "$fixture/artifact"
reject_install corrupt "checksum mismatch"
write_artifact "gitten v7.7.7"
write_manifest
reject_install wrong-version "unexpected version"
printf '#!/usr/bin/env bash\nexit 1\n' > "$fixture/artifact"
write_manifest
reject_install broken "did not run"
SCENARIO_OS=Plan9 reject_install unsupported "Unsupported platform"

for system in MINGW64_NT MSYS_NT CYGWIN_NT; do
  SCENARIO_OS="$system" reject_install windows "Use install.ps1 for native Windows"
done
mkdir "$fixture/destination-is-dir" "$fixture/destination-is-dir/gitten"
if GITTEN_INSTALL_DIR="$fixture/destination-is-dir" bash "$root/install.sh" >"$fixture/log" 2>&1; then
  printf '%s\n' "Unexpected success with a directory in place of the binary" >&2
  exit 1
fi
grep -F "install destination is a directory" "$fixture/log"
[[ -z "$(find "$fixture/destination-is-dir/gitten" -mindepth 1 -print)" ]]

mkdir "$fixture/system-bin"
defaults=$(bash -c '
  source "$1"
  install_destination "" "$2"
  install_destination "" "$3"
' _ "$root/install.sh" "$fixture/system-bin" "$fixture/missing-bin")
[[ "$defaults" == "$fixture/system-bin"$'\n'"$HOME/.local/bin" ]]

write_artifact "gitten v1.2.3"
while read -r os arch asset; do
  write_manifest "$asset"
  SCENARIO_OS="$os" SCENARIO_ARCH="$arch" SCENARIO_ASSET="$asset" bash "$root/install.sh" > "$fixture/log"
  grep -F "Downloading $asset" "$fixture/log"
  [[ "$("$prev" --version)" == "gitten v1.2.3" ]]
done <<'TARGETS'
Darwin arm64 gitten-darwin-arm64
Darwin x86_64 gitten-darwin-x64
Linux aarch64 gitten-linux-arm64
Linux arm64 gitten-linux-arm64
TARGETS

write_manifest gitten-linux-x64
PATH="$GITTEN_INSTALL_DIR:$PATH" bash < "$root/install.sh" > "$fixture/log"
[[ "$("$prev" --version)" == "gitten v1.2.3" ]]
if grep -F 'Add ' "$fixture/log"; then
  printf '%s\n' 'Unexpected PATH hint for a reachable installation' >&2
  exit 1
fi

if [[ -n "${GITTEN_TEST_BINARY:-}" ]]; then
  cp "$GITTEN_TEST_BINARY" "$fixture/artifact"
  native_asset=$(basename "$GITTEN_TEST_BINARY")
  native_version=$("$GITTEN_TEST_BINARY" --version)
  write_manifest "$native_asset"
  SCENARIO_OS="$native_os" SCENARIO_ARCH="$native_arch" SCENARIO_ASSET="$native_asset" \
    SCENARIO_TAG="${native_version#gitten }" bash "$root/install.sh" > "$fixture/log"
  [[ "$("$prev" --version)" == "$native_version" ]]
  "$prev" --help | grep -F 'Usage: gitten'
fi
