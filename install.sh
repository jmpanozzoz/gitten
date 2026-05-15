#!/usr/bin/env bash
set -euo pipefail

REPO="jmpanozzoz/gitten"
BINARY="gitten"
DEFAULT_INSTALL_DIR="/usr/local/bin"
BAR_WIDTH=36

# ── ANSI colors (stripped when not a TTY) ─────────────────────────────────────
if [ -t 1 ]; then
  RST='\033[0m'  BLD='\033[1m'  DIM='\033[2m'
  GRN='\033[0;32m'  BGN='\033[1;32m'  CYN='\033[0;36m'
  YLW='\033[1;33m'  RED='\033[0;31m'
else
  RST=''  BLD=''  DIM=''  GRN=''  BGN=''  CYN=''  YLW=''  RED=''
fi

# ── clack-style primitives ─────────────────────────────────────────────────────
_D="${DIM}│${RST}"   # dim │  (border)
_A="${CYN}◆${RST}"   # cyan ◆ (active)
_C="${DIM}◇${RST}"   # dim  ◇ (completed / info)
_E="${DIM}└${RST}"   # dim  └ (outro)

intro()   { printf "\n  ${_D}\n  ${_C}  ${BLD}%s${RST}\n  ${_D}\n" "$1"; }
outro()   { printf "  ${_D}\n  ${_E}  %s\n\n" "$1"; }
log_sep() { printf "  ${_D}\n"; }
log_msg() { printf "  ${_D}  %s\n" "$1"; }
log_row() { printf "  ${_D}  ${DIM}%-12s${RST}  %s\n" "$1" "$2"; }
log_ok()  { printf "  ${_C}  ${BGN}✓${RST}  %s\n" "$1"; }
log_warn(){ printf "  ${_D}  ${YLW}▲${RST}  %s\n" "$1"; }
log_err() { printf "  ${_D}  ${RED}✗${RST}  %s\n" "$1" >&2; exit 1; }
log_act() { printf "  ${_A}  %s\n" "$1"; }

draw_bar() {
  local pct="$1" i filled=0 empty=0 filled_s="" empty_s=""
  filled=$(( (pct * BAR_WIDTH) / 100 ))
  empty=$(( BAR_WIDTH - filled ))
  for ((i=0; i<filled; i++)); do filled_s+="─"; done
  for ((i=0; i<empty;  i++)); do empty_s+="─"; done
  printf "  ${_D}  ${BLD}%s${RST}${DIM}%s${RST}  %3d%%" "$filled_s" "$empty_s" "$pct"
}

# ── OS / arch ─────────────────────────────────────────────────────────────────
OS=$(uname -s); ARCH=$(uname -m)

case "$OS" in
  MINGW* | MSYS* | CYGWIN*)
    intro "🐱 gitten installer"
    log_warn "Windows via Git Bash / MSYS detected."
    log_sep
    log_msg "Use the PowerShell installer for native Windows support:"
    log_sep
    log_msg "  ${BLD}irm https://raw.githubusercontent.com/${REPO}/main/install.ps1 | iex${RST}"
    outro "See you on the other side 🐱"
    exit 0 ;;
  Darwin)
    case "$ARCH" in
      arm64)  ASSET="gitten-darwin-arm64"; PLATFORM="macOS  arm64" ;;
      x86_64) ASSET="gitten-darwin-x64";   PLATFORM="macOS  x64"   ;;
      *) log_err "Unsupported architecture: $ARCH" ;;
    esac ;;
  Linux)
    WSL_HINT=""; grep -qi microsoft /proc/version 2>/dev/null && WSL_HINT=" · WSL"
    [ -n "${WSL_DISTRO_NAME:-}" ] && WSL_HINT=" · WSL"
    case "$ARCH" in
      x86_64)          ASSET="gitten-linux-x64";  PLATFORM="Linux  x64${WSL_HINT}"  ;;
      aarch64 | arm64) ASSET="gitten-linux-arm64"; PLATFORM="Linux  arm64${WSL_HINT}" ;;
      *) log_err "Unsupported architecture: $ARCH" ;;
    esac ;;
  *) printf "${RED}Unsupported OS: %s${RST}\n" "$OS" >&2; exit 1 ;;
esac

# ── Previous version ───────────────────────────────────────────────────────────
PREV_VER=""
command -v "$BINARY" &>/dev/null && PREV_VER=$("$BINARY" --version 2>/dev/null || true)

# ── Install directory ──────────────────────────────────────────────────────────
if [ -w "$DEFAULT_INSTALL_DIR" ]; then
  INSTALL_DIR="$DEFAULT_INSTALL_DIR"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi
DEST="$INSTALL_DIR/$BINARY"
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$ASSET"

# ── Header ─────────────────────────────────────────────────────────────────────
intro "🐱 gitten installer"
log_row "Platform" "$PLATFORM"
log_row "Binary"   "$ASSET"
log_row "Target"   "$DEST"
log_sep

# ── Download with progress bar ─────────────────────────────────────────────────
TMPFILE=$(mktemp)
cleanup() { rm -f "$TMPFILE"; printf '\033[?25h'; }
trap cleanup EXIT

printf '\033[?25l'       # hide cursor during download

log_act "Downloading $ASSET"
draw_bar 0              # initial empty bar (no newline — will be overwritten)

# Run curl in the background; redirect its -# progress output to the temp file
curl -fsSL -# "$DOWNLOAD_URL" -o "$DEST" 2>"$TMPFILE" &
CURL_PID=$!

while kill -0 "$CURL_PID" 2>/dev/null; do
  sleep 0.12
  PROG=$(tr '\r' '\n' < "$TMPFILE" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+%' | tail -1)
  if [ -n "$PROG" ]; then
    PCT="${PROG%%%*}"   # strip trailing %
    PCT="${PCT%%.*}"    # integer part only
    [ "$PCT" -gt 100 ] && PCT=100
    printf '\r'; draw_bar "$PCT"
  fi
done

CURL_STATUS=0
wait $CURL_PID || CURL_STATUS=$?
printf '\033[?25h'      # restore cursor
rm -f "$TMPFILE"

if [ $CURL_STATUS -ne 0 ]; then
  printf '\r\033[2K\n'
  log_err "Download failed. Check https://github.com/$REPO/releases"
fi

printf '\r'; draw_bar 100; printf '\n'
chmod +x "$DEST"

# ── Verify ─────────────────────────────────────────────────────────────────────
log_sep
log_ok "Installed at $DEST"

NEW_VER=$("$DEST" --version 2>/dev/null || true)
if [ -n "$NEW_VER" ]; then
  log_ok "Verified  ${BLD}${NEW_VER}${RST}"
else
  log_warn "Could not verify — try: $DEST --version"
fi

# ── PATH hint ──────────────────────────────────────────────────────────────────
if ! command -v "$BINARY" &>/dev/null 2>&1; then
  log_sep
  log_warn "Add this to your shell profile to use gitten from anywhere:"
  log_msg "  ${DIM}export PATH=\"\$HOME/.local/bin:\$PATH\"${RST}"
fi

# ── Outro ──────────────────────────────────────────────────────────────────────
if [ -n "$PREV_VER" ] && [ "$PREV_VER" != "$NEW_VER" ]; then
  outro "Updated ${DIM}${PREV_VER}${RST} → ${BLD}${NEW_VER}${RST}. Run: gitten"
else
  outro "${BLD}${NEW_VER:-gitten}${RST} installed. Run: gitten"
fi
