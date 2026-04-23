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

function createAgent(baseDir, name, description, extra) {
  fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
  const fm = extra ? `name: ${name}\ndescription: ${description}\n${extra}` : `name: ${name}\ndescription: ${description}\nmodel: sonnet\ntools:\n  - Read`;
  fs.writeFileSync(path.join(baseDir, 'agents', `${name}.md`), `---\n${fm}\n---\n\nContent.`);
}

// Test 1: Formats skills and agents with STATUS column
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();

  createSkill(coreDir, 'brainstorm', 'Core ideation and design exploration skill');
  createSkill(coreDir, 'plan', 'Core planning and task breakdown skill');
  createSkill(userDir, 'tdd', 'My personal TDD workflow and testing skill');
  createSkill(projDir, 'code-review', 'Team code review process and guidelines');
  createAgent(coreDir, 'explorer', 'Deep codebase analysis and navigation');

  const output = formatList({
    corePath: coreDir,
    userPath: userDir,
    projectPath: projDir,
    config: {}
  });

  assert.ok(output.includes('SKILLS'));
  assert.ok(output.includes('STATUS'));
  assert.ok(output.includes('brainstorm'));
  assert.ok(output.includes('ok'));
  assert.ok(output.includes('AGENTS'));
  assert.ok(output.includes('explorer'));
  assert.ok(output.includes('/fsd:validate'));

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

// Test 3: Override indicator [>] appears for shadowed content
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();

  createSkill(coreDir, 'plan', 'Core planning and task breakdown skill');
  createSkill(userDir, 'plan', 'Custom planning skill that overrides core');

  const output = formatList({
    corePath: coreDir,
    userPath: userDir,
    projectPath: '/nonexistent',
    config: {}
  });

  assert.ok(output.includes('[>]'));
  assert.ok(output.includes('user'));

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 4: Invalid content shows error count in status and header
{
  const coreDir = mkTmpDir();
  createSkill(coreDir, 'bad', 'Too short');
  createSkill(coreDir, 'good', 'A perfectly valid skill description here');

  const output = formatList({
    corePath: coreDir,
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {}
  });

  assert.ok(output.includes('1 invalid'));
  assert.ok(output.includes('err'));

  fs.rmSync(coreDir, { recursive: true });
}

console.log('  All list tests passed');
