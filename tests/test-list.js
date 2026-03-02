#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatList } = require(path.join(__dirname, '..', 'scripts', 'list.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

function createSkill(baseDir, name, description) {
  const skillDir = path.join(baseDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nContent.`);
}

function createAgent(baseDir, name, description) {
  fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\nContent.`);
}

// Test 1: Formats skills and agents from multiple layers
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();

  createSkill(coreDir, 'brainstorm', 'Core ideation');
  createSkill(coreDir, 'plan', 'Core planning');
  createSkill(userDir, 'tdd', 'My TDD workflow');
  createSkill(projDir, 'code-review', 'Team review process');
  createAgent(coreDir, 'explorer', 'Codebase analysis');

  const output = formatList({
    corePath: coreDir,
    userPath: userDir,
    projectPath: projDir,
    config: {}
  });

  // Check output contains expected content
  assert.ok(output.includes('SKILLS'));
  assert.ok(output.includes('brainstorm'));
  assert.ok(output.includes('core'));
  assert.ok(output.includes('tdd'));
  assert.ok(output.includes('user'));
  assert.ok(output.includes('code-review'));
  assert.ok(output.includes('project'));
  assert.ok(output.includes('AGENTS'));
  assert.ok(output.includes('explorer'));

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 2: Empty content shows helpful message
{
  const output = formatList({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {}
  });

  assert.ok(output.includes('No content'));
}

console.log('  All list tests passed');
