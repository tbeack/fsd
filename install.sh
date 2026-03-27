#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/tbeack/fsd.git"
INSTALL_DIR="${HOME}/.claude/plugins/fsd"
SETTINGS_FILE="${HOME}/.claude/settings.json"

# --- helpers ---

info()  { echo "  $1"; }
ok()    { echo "  [ok] $1"; }
fail()  { echo "  [error] $1" >&2; exit 1; }
warn()  { echo "  [warn] $1"; }

# --- preflight checks ---

echo ""
echo "FSD Installer"
echo "============="
echo ""

# Check git
if ! command -v git &>/dev/null; then
  fail "git is not installed. Install git and try again."
fi
ok "git found"

# Check node >= 18
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 18+ and try again."
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js $NODE_MAJOR found, but 18+ is required."
fi
ok "Node.js $NODE_MAJOR found"

# --- install or update ---

echo ""

if [ -d "$INSTALL_DIR" ]; then
  info "FSD already installed at $INSTALL_DIR"
  info "Pulling latest changes..."
  git -C "$INSTALL_DIR" pull origin main
  ok "Updated to latest"
else
  info "Installing FSD to $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
  ok "Cloned successfully"
fi

# --- run tests to verify ---

echo ""
info "Running tests..."

if bash "$INSTALL_DIR/tests/run-tests.sh" &>/dev/null; then
  ok "All tests passed"
else
  warn "Some tests failed. Run 'bash $INSTALL_DIR/tests/run-tests.sh' for details."
fi

# --- validate content ---

info "Validating content..."

VALIDATE_OUTPUT=$(node "$INSTALL_DIR/scripts/validate.js" "$INSTALL_DIR" 2>&1) || true
if echo "$VALIDATE_OUTPUT" | grep -q "0 error(s)"; then
  ok "All content passes schema validation"
else
  warn "Validation issues found. Run /fsd:validate in Claude Code for details."
fi

# --- check settings.json registration ---

echo ""

if [ -f "$SETTINGS_FILE" ]; then
  if grep -q "fsd" "$SETTINGS_FILE" 2>/dev/null; then
    ok "FSD found in $SETTINGS_FILE"
  else
    warn "FSD not found in $SETTINGS_FILE"
    info "If Claude Code doesn't auto-discover plugins, add this to settings.json:"
    echo ""
    echo "    \"plugins\": [\"~/.claude/plugins/fsd\"]"
    echo ""
  fi
else
  info "No settings.json found at $SETTINGS_FILE"
  info "Claude Code may auto-discover the plugin. If not, create settings.json with:"
  echo ""
  echo "    { \"plugins\": [\"~/.claude/plugins/fsd\"] }"
  echo ""
fi

# --- version info ---

VERSION=$(node -e "console.log(require('$INSTALL_DIR/.claude-plugin/plugin.json').version)")

echo ""
echo "FSD v${VERSION} installed at $INSTALL_DIR"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code (or start a new session)"
echo "  2. You should see 'FSD Framework Active' on startup"
echo "  3. Run /fsd:validate to confirm everything works"
echo "  4. Run /fsd:init in a project to create a .fsd/ space"
echo ""
