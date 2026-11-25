#!/usr/bin/env bash
set -euo pipefail

REPO="jmpanozzoz/gitten"
RELEASES="https://github.com/$REPO/releases"
RELEASE_API="https://api.github.com/repos/$REPO/releases/latest"

fail() { printf 'gitten installer: %s\n' "$1" >&2; exit 1; }

asset_for_host() {
  local system="$1" arch="$2"
  case "$system/$arch" in
    Darwin/arm64) printf '%s\n' gitten-darwin-arm64 ;;
    Darwin/x86_64) printf '%s\n' gitten-darwin-x64 ;;
    Linux/x86_64) printf '%s\n' gitten-linux-x64 ;;
    Linux/aarch64 | Linux/arm64) printf '%s\n' gitten-linux-arm64 ;;
    MINGW*/* | MSYS*/* | CYGWIN*/*) fail "Use install.ps1 for native Windows." ;;
    *) fail "Unsupported platform: $system $arch" ;;
  esac
}

read_release() {
  local response
  command -v jq >/dev/null 2>&1 || fail "Install jq to read trusted release metadata."
  response=$(curl -q -fsS --proto '=https' "$RELEASE_API") || fail "Could not resolve the latest release."
  tag=$(jq -ers 'select(length == 1) | .[0].tag_name | strings' <<< "$response") || fail "Invalid release metadata."
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Unexpected release tag."
  manifest_digest=$(jq -er '
    [.assets[]? | select(.name == "SHA256SUMS")] | select(length == 1) |
    .[0] | select(.state == "uploaded") | if (.digest | type) == "string" then .digest else "" end
  ' <<< "$response") || fail "Missing or ambiguous release manifest metadata."
  [[ "$manifest_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Invalid release manifest digest."
}

download() {
  curl -q -fsSL --proto '=https' --proto-redir '=https' -o "$2" "$1"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    fail "Install sha256sum or shasum to verify the download."
  fi
}

check_artifact() {
  local manifest="$1" asset="$2" file="$3" expected actual
  expected=$(awk -v asset="$asset" '$2 == asset {print $1}' "$manifest")
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "Missing or ambiguous checksum for $asset."
  actual=$(hash_file "$file")
  [[ "$actual" == "$expected" ]] || fail "SHA-256 checksum mismatch for $asset."
}

install_destination() {
  local override="$1" system_bin="$2"
  if [[ -n "$override" ]]; then
    printf '%s\n' "$override"
  elif [[ -d "$system_bin" && -w "$system_bin" ]]; then
    printf '%s\n' "$system_bin"
  else
    printf '%s\n' "$HOME/.local/bin"
  fi
}

install_gitten() {
  local tag manifest_digest manifest actual_manifest_digest
  asset=$(asset_for_host "$(uname -s)" "$(uname -m)")
  read_release
  target_dir=$(install_destination "${GITTEN_INSTALL_DIR:-}" /usr/local/bin)
  mkdir -p -- "$target_dir"
  target_dir=$(cd "$target_dir" && pwd -P)
  destination="$target_dir/gitten"
  [[ ! -d "$destination" ]] || fail "The install destination is a directory."
  temporary=$(mktemp -d "$target_dir/.gitten-install.XXXXXX")
  trap 'rm -rf -- "$temporary"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  printf 'Downloading %s from %s\n' "$asset" "$tag"
  base="$RELEASES/download/$tag"
  manifest="$temporary/SHA256SUMS"
  download "$base/SHA256SUMS" "$manifest" || fail "Could not download release checksums."
  actual_manifest_digest=$(hash_file "$manifest")
  [[ "sha256:$actual_manifest_digest" == "$manifest_digest" ]] || fail "SHA-256 checksum mismatch for the release manifest."
  download "$base/$asset" "$temporary/$asset" || fail "Could not download $asset."
  check_artifact "$manifest" "$asset" "$temporary/$asset"

  chmod +x "$temporary/$asset"
  version=$("$temporary/$asset" --version) || fail "The verified binary did not run."
  [[ "$version" == "gitten $tag" ]] || fail "The verified binary reported an unexpected version."

  mv -f -- "$temporary/$asset" "$destination" || fail "Could not replace $destination."
  printf 'Installed %s at %s\n' "$version" "$destination"
  entry_on_path=$(command -v gitten || true)
  if [[ ! "$entry_on_path" -ef "$destination" ]]; then
    printf 'Add %s to PATH or run the executable directly.\n' "$target_dir"
  fi
}

if [[ "${BASH_SOURCE[0]-$0}" == "$0" ]]; then
  install_gitten
fi
