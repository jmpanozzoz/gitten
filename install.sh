#!/usr/bin/env bash
set -euo pipefail

REPO="jmpanozzoz/gitten"
BINARY="gitten"
DEFAULT_INSTALL_DIR="/usr/local/bin"

# ── Detect OS ──────────────────────────────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)   ASSET="gitten-darwin-arm64" ;;
      x86_64)  ASSET="gitten-darwin-x64"   ;;
      *)        echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64)          ASSET="gitten-linux-x64"   ;;
      aarch64 | arm64) ASSET="gitten-linux-arm64"  ;;
      *)                echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

# ── Detect existing version ────────────────────────────────────────────────────
PREVIOUS_VERSION=""
if command -v "$BINARY" &>/dev/null; then
  PREVIOUS_VERSION=$("$BINARY" --version 2>/dev/null || true)
fi

# ── Resolve install directory ──────────────────────────────────────────────────
if [ -w "$DEFAULT_INSTALL_DIR" ]; then
  INSTALL_DIR="$DEFAULT_INSTALL_DIR"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

DEST="$INSTALL_DIR/$BINARY"

# ── Download ───────────────────────────────────────────────────────────────────
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$ASSET"

echo "  Detected: $OS/$ARCH → $ASSET"
echo "  Downloading from: $DOWNLOAD_URL"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$DEST"; then
  echo "Download failed. Check that a release exists at:"
  echo "  https://github.com/$REPO/releases"
  exit 1
fi

chmod +x "$DEST"

# ── Verify ─────────────────────────────────────────────────────────────────────
echo "  Installed to: $DEST"

if ! command -v "$BINARY" &>/dev/null && [[ "$INSTALL_DIR" != "$DEFAULT_INSTALL_DIR" ]]; then
  echo ""
  echo "  Add the following to your shell profile to use gitten from anywhere:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

NEW_VERSION=$("$DEST" --version 2>/dev/null || true)

echo ""
if [[ -n "$PREVIOUS_VERSION" && "$PREVIOUS_VERSION" != "$NEW_VERSION" ]]; then
  echo "  Updated: $PREVIOUS_VERSION → $NEW_VERSION"
else
  echo "  $NEW_VERSION installed successfully."
fi
echo "  Run: gitten"
