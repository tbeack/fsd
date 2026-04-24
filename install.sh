#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/tbeack/fsd.git"
CLONE_DIR="${HOME}/.claude/plugins/fsd"       # working git clone (source of truth)
CACHE_BASE="${HOME}/.claude/plugins/cache/tbeack/fsd"
SETTINGS_FILE="${HOME}/.claude/settings.json"
INSTALLED_FILE="${HOME}/.claude/plugins/installed_plugins.json"
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

if ! command -v git &>/dev/null; then
  fail "git is not installed. Install git and try again."
fi
ok "git found"

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 18+ and try again."
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js $NODE_MAJOR found, but 18+ is required."
fi
ok "Node.js $NODE_MAJOR found"

# --- clone or update source repo ---

echo ""

if [ -d "$CLONE_DIR" ]; then
  if [ "$FORCE" = "--force" ]; then
    info "Force-resetting FSD source at $CLONE_DIR..."
    git -C "$CLONE_DIR" fetch origin main
    git -C "$CLONE_DIR" reset --hard origin/main
    ok "Source reset to origin/main"
  else
    info "Updating FSD source at $CLONE_DIR..."
    git -C "$CLONE_DIR" pull origin main
    ok "Source updated"
  fi
else
  info "Cloning FSD to $CLONE_DIR..."
  mkdir -p "$(dirname "$CLONE_DIR")"
  git clone "$REPO" "$CLONE_DIR"
  ok "Cloned"
fi

# --- run tests before deploying to cache ---

echo ""
info "Running tests..."

if bash "$CLONE_DIR/plugin/tests/run-tests.sh" &>/dev/null; then
  ok "All tests passed"
else
  warn "Some tests failed — run for details:"
  warn "  bash $CLONE_DIR/plugin/tests/run-tests.sh"
fi

# --- validate content ---

info "Validating content..."

VALIDATE_OUTPUT=$(node "$CLONE_DIR/plugin/scripts/validate.js" "$CLONE_DIR/plugin" 2>&1) || true
if echo "$VALIDATE_OUTPUT" | grep -q "0 error(s)"; then
  ok "All content passes schema validation"
else
  warn "Validation issues found — run /fsd:validate in Claude Code for details."
fi

# --- sync plugin content into Claude Code's cache ---

echo ""
info "Syncing plugin content to Claude Code cache..."

VERSION=$(node -e "console.log(require('$CLONE_DIR/plugin/.claude-plugin/plugin.json').version)")
CACHE_DIR="$CACHE_BASE/$VERSION"

# Remove stale versioned cache dirs (keep only the target version)
if [ -d "$CACHE_BASE" ]; then
  for old_dir in "$CACHE_BASE"/*/; do
    [ -d "$old_dir" ] || continue
    old_ver=$(basename "$old_dir")
    if [ "$old_ver" != "$VERSION" ]; then
      rm -rf "$old_dir"
      info "Removed stale cache: $old_ver"
    fi
  done
fi

mkdir -p "$CACHE_DIR"
cp -r "$CLONE_DIR/plugin/." "$CACHE_DIR/"
ok "Plugin content synced to $CACHE_DIR"

# --- update installed_plugins.json ---

GIT_SHA=$(git -C "$CLONE_DIR" rev-parse HEAD)
INSTALLED_AT=$(node -e "
try {
  const d = JSON.parse(require('fs').readFileSync('$INSTALLED_FILE', 'utf8'));
  const e = (d.plugins['fsd@tbeack'] || [])[0];
  console.log(e ? e.installedAt : new Date().toISOString());
} catch(e) { console.log(new Date().toISOString()); }
")

node -e "
const fs = require('fs');
let data;
try { data = JSON.parse(fs.readFileSync('$INSTALLED_FILE', 'utf8')); }
catch(e) { data = { version: 2, plugins: {} }; }
data.plugins['fsd@tbeack'] = [{
  scope: 'user',
  installPath: '$CACHE_DIR',
  version: '$VERSION',
  installedAt: '$INSTALLED_AT',
  lastUpdated: new Date().toISOString(),
  gitCommitSha: '$GIT_SHA',
}];
fs.writeFileSync('$INSTALLED_FILE', JSON.stringify(data, null, 2) + '\n');
"
ok "Updated installed_plugins.json → fsd@tbeack v$VERSION"

# --- enable plugin in settings.json ---

if [ -f "$SETTINGS_FILE" ]; then
  IS_ENABLED=$(node -e "
  try {
    const d = JSON.parse(require('fs').readFileSync('$SETTINGS_FILE', 'utf8'));
    console.log((d.enabledPlugins || {})['fsd@tbeack'] === true ? 'yes' : 'no');
  } catch(e) { console.log('no'); }
  ")

  if [ "$IS_ENABLED" = "yes" ]; then
    ok "Plugin already enabled in settings.json"
  else
    node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
    data.enabledPlugins = data.enabledPlugins || {};
    data.enabledPlugins['fsd@tbeack'] = true;
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(data, null, 2) + '\n');
    "
    ok "Enabled fsd@tbeack in settings.json"
  fi
else
  warn "No settings.json found at $SETTINGS_FILE"
  info "Create it with: { \"enabledPlugins\": { \"fsd@tbeack\": true } }"
fi

# --- done ---

echo ""
echo "FSD v${VERSION} ready"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code (or start a new session)"
echo "  2. You should see FSD skills available (brainstorm, plan, execute, fsd-*)"
echo "  3. Run /fsd:validate to confirm everything works"
echo "  4. Run /fsd:init in a project to create a .fsd/ space"
echo ""
echo "To force a clean reinstall of the core at any time:"
echo "  bash install.sh --force"
echo ""
