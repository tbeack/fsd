#!/usr/bin/env node
'use strict';

// Tests for plugin/hooks/scripts/fsd-statusline.js
// Uses spawnSync to invoke the script with synthetic stdin.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'scripts', 'fsd-statusline.js');

function run(data) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(data),
    encoding: 'utf8',
    timeout: 5000,
  });
  return result;
}

function tmpSession() {
  return `fsd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

// --- Test 1: bridge file written with correct fields ---
test('bridge file written with correct fields', () => {
  const sessionId = tmpSession();
  const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  if (fs.existsSync(bridgePath)) fs.unlinkSync(bridgePath);

  run({
    session_id: sessionId,
    model: { display_name: 'Claude Sonnet' },
    workspace: { current_dir: '/tmp/proj' },
    context_window: { remaining_percentage: 60, total_tokens: 200000 },
  });

  assert.ok(fs.existsSync(bridgePath), 'bridge file should exist');
  const data = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
  assert.strictEqual(data.session_id, sessionId);
  assert.strictEqual(data.remaining_percentage, 60);
  assert.strictEqual(data.used_pct, 40);
  assert.ok(typeof data.timestamp === 'number' && data.timestamp > 0);

  fs.unlinkSync(bridgePath);
});

// --- Test 2: bridge file NOT written when remaining_percentage is absent ---
test('bridge file not written when remaining_percentage absent', () => {
  const sessionId = tmpSession();
  const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  if (fs.existsSync(bridgePath)) fs.unlinkSync(bridgePath);

  run({
    session_id: sessionId,
    model: { display_name: 'Claude Sonnet' },
    workspace: { current_dir: '/tmp/proj' },
    context_window: {},
  });

  assert.ok(!fs.existsSync(bridgePath), 'bridge file should NOT exist when remaining is absent');
});

// --- Test 3: session ID with path traversal → bridge file not written, exit 0 ---
test('path-traversal session ID rejected', () => {
  const sessionId = '../evil';
  const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);

  const result = run({
    session_id: sessionId,
    model: { display_name: 'Claude Sonnet' },
    workspace: { current_dir: '/tmp/proj' },
    context_window: { remaining_percentage: 60 },
  });

  assert.strictEqual(result.status, 0, 'should exit 0');
  assert.ok(!fs.existsSync(bridgePath), 'bridge file should NOT be written for traversal session ID');
});

// --- Test 4: stdout contains model name ---
test('stdout contains model name', () => {
  const result = run({
    session_id: tmpSession(),
    model: { display_name: 'Claude Sonnet 4.6' },
    workspace: { current_dir: '/tmp/proj' },
    context_window: { remaining_percentage: 70 },
  });

  assert.ok(result.stdout.includes('Claude Sonnet 4.6'), `stdout should contain model name, got: ${result.stdout}`);
});

// --- Test 5: stdout contains context bar character when remaining_percentage present ---
test('stdout contains context bar when remaining_percentage present', () => {
  const result = run({
    session_id: tmpSession(),
    model: { display_name: 'Claude' },
    workspace: { current_dir: '/tmp/proj' },
    context_window: { remaining_percentage: 50 },
  });

  assert.ok(
    result.stdout.includes('█') || result.stdout.includes('░'),
    `stdout should contain bar characters, got: ${result.stdout}`
  );
});

// --- Test 6: stdout contains dirname ---
test('stdout contains directory name', () => {
  const result = run({
    session_id: tmpSession(),
    model: { display_name: 'Claude' },
    workspace: { current_dir: '/Users/theo/myproject' },
    context_window: { remaining_percentage: 70 },
  });

  assert.ok(result.stdout.includes('myproject'), `stdout should contain dirname, got: ${result.stdout}`);
});

// --- Test 7: renderStatusline export is a function ---
test('renderStatusline export is a function', () => {
  const mod = require(SCRIPT);
  assert.strictEqual(typeof mod.renderStatusline, 'function');
});

// --- Test 8: writeBridge export is a function ---
test('writeBridge export is a function', () => {
  const mod = require(SCRIPT);
  assert.strictEqual(typeof mod.writeBridge, 'function');
});

// --- Summary ---
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
