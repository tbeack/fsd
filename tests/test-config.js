#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require(path.join(__dirname, '..', 'scripts', 'config.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

function writeYaml(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), content);
}

// Test 1: Single layer — reads core config
{
  const coreDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: plan-execute-verify\nskills_dir: "./skills"');

  const config = loadConfig({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent' });
  assert.strictEqual(config.workflow, 'plan-execute-verify');
  assert.strictEqual(config.skills_dir, './skills');

  fs.rmSync(coreDir, { recursive: true });
}

// Test 2: User overrides core
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: plan-execute-verify\nskills_dir: "./skills"');
  writeYaml(userDir, 'workflow: my-custom-flow');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  assert.strictEqual(config.workflow, 'my-custom-flow');
  assert.strictEqual(config.skills_dir, './skills'); // inherited from core

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 3: Project overrides both
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: core-flow\nskills_dir: "./skills"');
  writeYaml(userDir, 'workflow: user-flow\nagents_dir: "./my-agents"');
  writeYaml(projDir, 'workflow: project-flow');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: projDir });
  assert.strictEqual(config.workflow, 'project-flow');
  assert.strictEqual(config.skills_dir, './skills');
  assert.strictEqual(config.agents_dir, './my-agents');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 4: Missing config files are gracefully skipped
{
  const config = loadConfig({ corePath: '/nonexistent', userPath: '/nonexistent', projectPath: '/nonexistent' });
  assert.deepStrictEqual(config, {});
}

// Test 5: Array values merge by replacement (not concatenation)
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'disabled:\n  - "skills/brainstorm"\n  - "skills/debug"');
  writeYaml(userDir, 'disabled:\n  - "skills/verify"');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  // Shallow merge: user's disabled array replaces core's entirely
  assert.deepStrictEqual(config.disabled, ['skills/verify']);

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

console.log('  All config tests passed');
