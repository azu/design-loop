#!/bin/sh
set -eu

REPO="azu/design-loop"
INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="design-loop"
PATH_LINE="export PATH=\"\$HOME/.local/bin:\$PATH\""

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

URL="https://github.com/${REPO}/releases/latest/download/${BIN_NAME}-${OS}-${ARCH}"

mkdir -p "$INSTALL_DIR"
echo "Downloading ${BIN_NAME}..."
curl -fsSL "$URL" -o "${INSTALL_DIR}/${BIN_NAME}"
chmod +x "${INSTALL_DIR}/${BIN_NAME}"

echo "Installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}"

# Add ~/.local/bin to PATH in shell rc files if not already present
add_to_rc() {
  rc_file="$1"
  if [ -f "$rc_file" ]; then
    if ! grep -q '\.local/bin' "$rc_file" 2>/dev/null; then
      echo "" >> "$rc_file"
      echo "# design-loop" >> "$rc_file"
      echo "$PATH_LINE" >> "$rc_file"
      echo "Added PATH to $rc_file"
    fi
  fi
}

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
    case "$SHELL_NAME" in
      zsh)  add_to_rc "${HOME}/.zshrc" ;;
      bash) add_to_rc "${HOME}/.bashrc" ;;
      *)    add_to_rc "${HOME}/.bashrc" ;;
    esac
    echo ""
    echo "Restart your terminal or run:"
    echo ""
    echo "  $PATH_LINE"
    ;;
esac
