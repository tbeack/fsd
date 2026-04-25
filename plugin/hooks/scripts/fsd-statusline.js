#!/usr/bin/env node

'use strict';

// FSD statusline — Notification hook.
// Renders: model | dirname | context_bar
// Side-effect: writes /tmp/claude-ctx-{session_id}.json for fsd-context-monitor.

const fs = require('fs');
const os = require('os');
const path = require('path');

function buildContextBar(remaining) {
  const used = Math.max(0, Math.min(100, Math.round(100 - remaining)));
  const filled = Math.floor(used / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  if (used < 50) return ` \x1b[32m${bar} ${used}%\x1b[0m`;
  if (used < 65) return ` \x1b[33m${bar} ${used}%\x1b[0m`;
  if (used < 80) return ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
  return ` \x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;
}

function writeBridge(sessionId, remaining) {
  if (remaining == null) return;
  try {
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
    fs.writeFileSync(bridgePath, JSON.stringify({
      session_id: sessionId,
      remaining_percentage: remaining,
      used_pct: Math.round(100 - remaining),
      timestamp: Math.floor(Date.now() / 1000),
    }));
  } catch (_) { /* best-effort — never break the statusline */ }
}

function renderStatusline(data) {
  const model = data.model?.display_name || 'Claude';
  const dir = data.workspace?.current_dir || process.cwd();
  const dirname = path.basename(dir);
  const remaining = data.context_window?.remaining_percentage;
  const ctx = remaining != null ? buildContextBar(remaining) : '';
  return `\x1b[2m${model}\x1b[0m │ \x1b[2m${dirname}\x1b[0m${ctx}`;
}

function runStatusline() {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      const sessionId = data.session_id;

      if (sessionId && !/[/\\]|\.\./.test(sessionId)) {
        writeBridge(sessionId, data.context_window?.remaining_percentage);
      }

      process.stdout.write(renderStatusline(data));
    } catch (_) { /* silent fail */ }
  });
}

module.exports = { renderStatusline, writeBridge, buildContextBar };

if (require.main === module) runStatusline();
