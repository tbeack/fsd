#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, getStructure, DEFAULT_STRUCTURE } = require(path.join(__dirname, '..', 'scripts', 'config.js'));

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

// Test 5: Arrays concatenate with dedup
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'disabled:\n  - "skills/brainstorm"\n  - "skills/debug"');
  writeYaml(userDir, 'disabled:\n  - "skills/verify"\n  - "skills/debug"');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  // Concatenate + dedup: [brainstorm, debug, verify]
  assert.strictEqual(config.disabled.length, 3);
  assert.ok(config.disabled.includes('skills/brainstorm'));
  assert.ok(config.disabled.includes('skills/debug'));
  assert.ok(config.disabled.includes('skills/verify'));

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 6: Objects merge recursively
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'conventions:\n  commit_style: conventional\n  test_before_complete: true');
  writeYaml(userDir, 'conventions:\n  commit_style: gitmoji');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  assert.strictEqual(config.conventions.commit_style, 'gitmoji');
  assert.strictEqual(config.conventions.test_before_complete, 'true');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 7: !replace suffix forces full replacement for arrays
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'disabled:\n  - "skills/brainstorm"\n  - "skills/debug"');
  writeYaml(userDir, 'disabled!replace:\n  - "skills/verify"');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  assert.deepStrictEqual(config.disabled, ['skills/verify']);

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 8: Scalar values still last-writer-wins across three layers
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: core-flow');
  writeYaml(userDir, 'workflow: user-flow');
  writeYaml(projDir, 'workflow: project-flow');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: projDir });
  assert.strictEqual(config.workflow, 'project-flow');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 9: getStructure returns defaults when config has no structure key
{
  const structure = getStructure({});
  assert.deepStrictEqual(structure, { skills: 'skills', agents: 'agents', commands: 'commands' });
  assert.deepStrictEqual(structure, { ...DEFAULT_STRUCTURE });
}

// Test 10: getStructure returns defaults when config is undefined
{
  const structure = getStructure(undefined);
  assert.deepStrictEqual(structure, { ...DEFAULT_STRUCTURE });
}

// Test 11: getStructure applies partial overrides; unset kinds default
{
  const structure = getStructure({ structure: { skills: 'capabilities' } });
  assert.strictEqual(structure.skills, 'capabilities');
  assert.strictEqual(structure.agents, 'agents');
  assert.strictEqual(structure.commands, 'commands');
}

// Test 12: getStructure applies full override
{
  const structure = getStructure({ structure: { skills: 'a', agents: 'b', commands: 'c' } });
  assert.deepStrictEqual(structure, { skills: 'a', agents: 'b', commands: 'c' });
}

// Test 13: getStructure drops invalid override (slashes) and uses defaults
{
  const originalStderrWrite = process.stderr.write;
  let captured = '';
  process.stderr.write = (msg) => { captured += msg; return true; };
  try {
    const structure = getStructure({ structure: { skills: 'bad/path' } });
    assert.deepStrictEqual(structure, { ...DEFAULT_STRUCTURE });
    assert.ok(captured.includes('structure.skills'), 'expected warning about structure.skills');
  } finally {
    process.stderr.write = originalStderrWrite;
  }
}

// Test 14: getStructure drops aliases (two kinds same value)
{
  const originalStderrWrite = process.stderr.write;
  let captured = '';
  process.stderr.write = (msg) => { captured += msg; return true; };
  try {
    const structure = getStructure({ structure: { skills: 'shared', agents: 'shared' } });
    assert.deepStrictEqual(structure, { ...DEFAULT_STRUCTURE });
    assert.ok(captured.includes('conflicts'), 'expected alias conflict warning');
  } finally {
    process.stderr.write = originalStderrWrite;
  }
}

// Test 15: getStructure reads structure from loaded layered config (integration)
{
  const coreDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: plan');
  writeYaml(projDir, 'structure:\n  skills: capabilities');

  const config = loadConfig({ corePath: coreDir, userPath: '/nonexistent', projectPath: projDir });
  const structure = getStructure(config);
  assert.strictEqual(structure.skills, 'capabilities');
  assert.strictEqual(structure.agents, 'agents');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 16: DEFAULT_STRUCTURE is frozen (cannot be mutated by callers)
{
  assert.throws(() => { DEFAULT_STRUCTURE.skills = 'mutated'; }, /read[-\s]?only|Cannot assign|object is not extensible/i);
}

console.log('  All config tests passed');
