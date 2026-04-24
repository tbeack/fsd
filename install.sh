#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/tbeack/fsd.git"
INSTALL_DIR="${HOME}/.claude/plugins/fsd"
FORCE="${1:-}"

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

if [ "$FORCE" = "--force" ]; then
  info "Mode: force reinstall (core overwrite, ~/.fsd/ user layer untouched)"
  echo ""
fi

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
  if [ "$FORCE" = "--force" ]; then
    info "Force-reinstalling FSD core at $INSTALL_DIR..."
    info "(~/.fsd/ user layer and project .fsd/ dirs are untouched)"
    git -C "$INSTALL_DIR" fetch origin main
    git -C "$INSTALL_DIR" reset --hard origin/main
    ok "Core reset to origin/main"
  else
    info "FSD already installed at $INSTALL_DIR — updating..."
    info "Tip: use --force to hard-reset the core if you hit issues"
    git -C "$INSTALL_DIR" pull origin main
    ok "Updated to latest"
  fi
else
  info "Installing FSD to $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
  ok "Cloned successfully"
fi

# --- run tests to verify ---

echo ""
info "Running tests..."

if bash "$INSTALL_DIR/plugin/tests/run-tests.sh" &>/dev/null; then
  ok "All tests passed"
else
  warn "Some tests failed — run for details:"
  warn "  bash $INSTALL_DIR/plugin/tests/run-tests.sh"
fi

# --- validate content ---

info "Validating content..."

VALIDATE_OUTPUT=$(node "$INSTALL_DIR/plugin/scripts/validate.js" "$INSTALL_DIR/plugin" 2>&1) || true
if echo "$VALIDATE_OUTPUT" | grep -q "0 error(s)"; then
  ok "All content passes schema validation"
else
  warn "Validation issues found — run /fsd:validate in Claude Code for details."
fi

# --- verify plugin discovery ---

echo ""

PLUGIN_JSON="$INSTALL_DIR/plugin/.claude-plugin/plugin.json"
if [ -f "$PLUGIN_JSON" ]; then
  # Claude Code auto-discovers plugins placed under ~/.claude/plugins/ — no settings.json
  # entry is required. Presence of plugin.json confirms the layout is correct.
  ok "Plugin manifest found — Claude Code will auto-discover from ~/.claude/plugins/"
else
  warn "Plugin manifest missing at $PLUGIN_JSON — installation may be incomplete."
  warn "Try: bash install.sh --force"
fi

# --- version info ---

VERSION=$(node -e "console.log(require('$INSTALL_DIR/plugin/.claude-plugin/plugin.json').version)" 2>/dev/null || echo "unknown")

echo ""
echo "FSD v${VERSION} installed at $INSTALL_DIR"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code (or start a new session)"
echo "  2. You should see 'FSD Framework Active' on startup"
echo "  3. Run /fsd:validate to confirm everything works"
echo "  4. Run /fsd:init in a project to create a .fsd/ space"
echo ""
echo "To force a clean reinstall of the core at any time:"
echo "  bash install.sh --force"
echo ""
