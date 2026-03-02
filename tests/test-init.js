#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { initProject } = require(path.join(__dirname, '..', 'scripts', 'init.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

// Test 1: Creates .fsd/ directory structure
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir);

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'config.yaml')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'agents')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'commands')), true);

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 2: Config template has expected content
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);

  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.ok(config.includes('workflow:'));
  assert.ok(config.includes('disabled:'));

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 3: Does not overwrite existing .fsd/
{
  const tmpDir = mkTmpDir();
  fs.mkdirSync(path.join(tmpDir, '.fsd'));
  fs.writeFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'workflow: custom');

  const result = initProject(tmpDir);
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('already exists'));

  // Original content preserved
  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.strictEqual(config, 'workflow: custom');

  fs.rmSync(tmpDir, { recursive: true });
}

console.log('  All init tests passed');
