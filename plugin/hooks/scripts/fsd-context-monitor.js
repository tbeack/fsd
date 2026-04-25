#!/usr/bin/env node

'use strict';

// Context Monitor — PostToolUse hook.
// Reads context metrics from the statusline bridge file written by fsd-statusline.js
// and injects warnings when context usage is high. This makes the agent aware of
// context limits (the statusline only shows the user).
//
// Thresholds:
//   WARNING  (remaining <= 35%): agent should wrap up current task
//   CRITICAL (remaining <= 25%): agent should stop immediately
//
// Debounce: 5 tool uses between warnings to avoid spam.
// Severity escalation bypasses debounce (WARNING -> CRITICAL fires immediately).

const fs = require('fs');
const os = require('os');
const path = require('path');

const WARNING_THRESHOLD = 35;
const CRITICAL_THRESHOLD = 25;
const STALE_SECONDS = 60;
const DEBOUNCE_CALLS = 5;

let input = '';

// Timeout guard: exit silently if stdin doesn't close within 10s.
const stdinTimeout = setTimeout(() => process.exit(0), 10000);

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;

    if (!sessionId) process.exit(0);

    // Reject session IDs that contain path traversal sequences or path separators.
    if (/[/\\]|\.\./.test(sessionId)) process.exit(0);

    // Check if context warnings are disabled via .fsd/config.json.
    const cwd = data.cwd || process.cwd();
    const fsdDir = path.join(cwd, '.fsd');

    if (fs.existsSync(fsdDir)) {
      try {
        const configPath = path.join(fsdDir, 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.hooks?.context_warnings === false) process.exit(0);
      } catch (_) { /* config may not exist — ignore */ }
    }

    const metricsPath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);

    // No metrics file — subagent or fresh session with no statusline.
    if (!fs.existsSync(metricsPath)) process.exit(0);

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);

    // Ignore stale metrics.
    if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) process.exit(0);

    const remaining = metrics.remaining_percentage;
    const usedPct = metrics.used_pct;

    if (remaining > WARNING_THRESHOLD) process.exit(0);

    // Debounce.
    const warnPath = path.join(os.tmpdir(), `claude-ctx-${sessionId}-warned.json`);
    let warnData = { callsSinceWarn: 0, lastLevel: null };
    let firstWarn = true;

    if (fs.existsSync(warnPath)) {
      try {
        warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
        firstWarn = false;
      } catch (_) { /* corrupted — reset */ }
    }

    warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

    const isCritical = remaining <= CRITICAL_THRESHOLD;
    const currentLevel = isCritical ? 'critical' : 'warning';
    const severityEscalated = currentLevel === 'critical' && warnData.lastLevel === 'warning';

    if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
      fs.writeFileSync(warnPath, JSON.stringify(warnData));
      process.exit(0);
    }

    warnData.callsSinceWarn = 0;
    warnData.lastLevel = currentLevel;
    fs.writeFileSync(warnPath, JSON.stringify(warnData));

    const isFsdActive = fs.existsSync(fsdDir);

    let message;
    if (isCritical) {
      message = isFsdActive
        ? `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
          'Context is nearly exhausted. Inform the user immediately so they can decide how to proceed.'
        : `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
          'Context is nearly exhausted. Inform the user immediately so they can decide how to proceed.';
    } else {
      message = isFsdActive
        ? `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
          'Context is getting limited. Avoid starting new complex work or long exploration tasks.'
        : `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
          'Context is getting limited. Avoid starting new complex work or long exploration tasks.';
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }));
  } catch (_) {
    // Silent fail — never block tool execution.
    process.exit(0);
  }
});
