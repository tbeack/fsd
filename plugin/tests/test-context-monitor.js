#!/usr/bin/env node
'use strict';

// Tests for plugin/hooks/scripts/fsd-context-monitor.js
// Uses spawnSync to invoke the script with synthetic stdin.
// Bridge metrics files are written to os.tmpdir() using synthetic session IDs.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'scripts', 'fsd-context-monitor.js');

function tmpSession() {
  return `fsd-cm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function writeMetrics(sessionId, overrides = {}) {
  const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  const metrics = Object.assign(
    {
      session_id: sessionId,
      remaining_percentage: 50,
      used_pct: 50,
      timestamp: Math.floor(Date.now() / 1000),
    },
    overrides
  );
  fs.writeFileSync(bridgePath, JSON.stringify(metrics));
  return bridgePath;
}

function run(sessionId, extraInput = {}) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(Object.assign({ session_id: sessionId, cwd: os.tmpdir() }, extraInput)),
    encoding: 'utf8',
    timeout: 5000,
  });
  return result;
}

function cleanup(sessionId) {
  for (const suffix of ['', '-warned']) {
    const p = path.join(os.tmpdir(), `claude-ctx-${sessionId}${suffix}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

// --- Test 1: no metrics file → exit 0, stdout empty ---
test('no metrics file → exit 0, stdout empty', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);

  const result = run(sessionId);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '');
});

// --- Test 2: remaining_percentage = 50 → above threshold, no output ---
test('remaining 50% → above threshold, no output', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);
  writeMetrics(sessionId, { remaining_percentage: 50, used_pct: 50 });

  const result = run(sessionId);
  assert.strictEqual(result.stdout.trim(), '', 'no warning expected above 35%');
  cleanup(sessionId);
});

// --- Test 3: remaining_percentage = 30 → WARNING in additionalContext ---
test('remaining 30% → WARNING in additionalContext', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);
  writeMetrics(sessionId, { remaining_percentage: 30, used_pct: 70 });

  const result = run(sessionId);
  assert.ok(result.stdout.trim().length > 0, 'expected output');
  const out = JSON.parse(result.stdout);
  const msg = out.hookSpecificOutput.additionalContext;
  assert.ok(msg.startsWith('CONTEXT WARNING'), `expected WARNING, got: ${msg}`);
  assert.ok(msg.includes('30'), 'message should include remaining %');
  cleanup(sessionId);
});

// --- Test 4: remaining_percentage = 20 → CRITICAL in additionalContext ---
test('remaining 20% → CRITICAL in additionalContext', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);
  writeMetrics(sessionId, { remaining_percentage: 20, used_pct: 80 });

  const result = run(sessionId);
  const out = JSON.parse(result.stdout);
  const msg = out.hookSpecificOutput.additionalContext;
  assert.ok(msg.startsWith('CONTEXT CRITICAL'), `expected CRITICAL, got: ${msg}`);
  cleanup(sessionId);
});

// --- Test 5: stale metrics (timestamp > 60s ago) → no output ---
test('stale metrics → no output', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);
  writeMetrics(sessionId, {
    remaining_percentage: 20,
    used_pct: 80,
    timestamp: Math.floor(Date.now() / 1000) - 120,
  });

  const result = run(sessionId);
  assert.strictEqual(result.stdout.trim(), '', 'stale metrics should produce no output');
  cleanup(sessionId);
});

// --- Test 6: debounce — first call emits, second call (within DEBOUNCE_CALLS) is silent ---
test('debounce — second call within limit is silent', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);
  writeMetrics(sessionId, { remaining_percentage: 30, used_pct: 70 });

  // First call — should emit
  const result1 = run(sessionId);
  assert.ok(result1.stdout.trim().length > 0, 'first call should emit warning');

  // Second call (callsSinceWarn = 1, limit = 5) — should be silent
  const result2 = run(sessionId);
  assert.strictEqual(result2.stdout.trim(), '', 'second call within debounce should be silent');

  cleanup(sessionId);
});

// --- Test 7: severity escalation — WARNING then CRITICAL bypasses debounce ---
test('severity escalation WARNING→CRITICAL bypasses debounce', () => {
  const sessionId = tmpSession();
  cleanup(sessionId);

  // First call at WARNING level
  writeMetrics(sessionId, { remaining_percentage: 30, used_pct: 70 });
  const result1 = run(sessionId);
  assert.ok(result1.stdout.trim().length > 0, 'first call should emit');

  // Immediately escalate to CRITICAL — should bypass debounce
  writeMetrics(sessionId, { remaining_percentage: 20, used_pct: 80 });
  const result2 = run(sessionId);
  assert.ok(result2.stdout.trim().length > 0, 'CRITICAL escalation should bypass debounce');
  const out = JSON.parse(result2.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith('CONTEXT CRITICAL'));

  cleanup(sessionId);
});

// --- Test 8: session ID with path traversal → exit 0, no output ---
test('path-traversal session ID → exit 0, no output', () => {
  const sessionId = '../evil';
  const result = run(sessionId);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '');
});

// --- Summary ---
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
