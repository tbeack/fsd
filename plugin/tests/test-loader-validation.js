#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadContent } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

function createSkill(baseDir, name, frontmatter) {
  const skillDir = path.join(baseDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
    `---\n${frontmatter}\n---\n\n# ${name}\n\nContent.`);
}

function createAgent(baseDir, name, frontmatter) {
  fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'agents', `${name}.md`),
    `---\n${frontmatter}\n---\n\nAgent content.`);
}

// Test 1: Valid skill has validation.valid = true
{
  const dir = mkTmpDir();
  createSkill(dir, 'plan', 'name: plan\ndescription: Turn design into ordered task list before coding');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const skill = content.skills[0];
  assert.strictEqual(skill.validation.valid, true);
  assert.strictEqual(skill.validation.errors.length, 0);

  fs.rmSync(dir, { recursive: true });
}

// Test 2: Skill with short description has validation error
{
  const dir = mkTmpDir();
  createSkill(dir, 'bad', 'name: bad\ndescription: Too short');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const skill = content.skills[0];
  assert.strictEqual(skill.validation.valid, false);
  assert.ok(skill.validation.errors.length > 0);
  assert.strictEqual(skill.name, 'bad');

  fs.rmSync(dir, { recursive: true });
}

// Test 3: Agent missing model has validation error
{
  const dir = mkTmpDir();
  createAgent(dir, 'broken', 'name: broken\ndescription: Test agent');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const agent = content.agents[0];
  assert.strictEqual(agent.validation.valid, false);
  assert.ok(agent.validation.errors.some(e => e.includes('model')));

  fs.rmSync(dir, { recursive: true });
}

// Test 4: Valid agent passes validation
{
  const dir = mkTmpDir();
  createAgent(dir, 'good',
    'name: good\ndescription: A good agent\nmodel: sonnet\ntools:\n  - Read\n  - Grep');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const agent = content.agents[0];
  assert.strictEqual(agent.validation.valid, true);

  fs.rmSync(dir, { recursive: true });
}

// Test 5: loadContent returns validationSummary
{
  const dir = mkTmpDir();
  createSkill(dir, 'good', 'name: good\ndescription: A perfectly valid skill description here');
  createSkill(dir, 'bad', 'name: bad\ndescription: Short');
  createAgent(dir, 'ok', 'name: ok\ndescription: OK agent\nmodel: sonnet\ntools:\n  - Read');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  assert.strictEqual(content.validationSummary.total, 3);
  assert.strictEqual(content.validationSummary.valid, 2);
  assert.strictEqual(content.validationSummary.invalid, 1);

  fs.rmSync(dir, { recursive: true });
}

// Test 6: Override indicator set when shadowing
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  createSkill(coreDir, 'plan', 'name: plan\ndescription: Core planning skill for task breakdown');
  createSkill(userDir, 'plan', 'name: plan\ndescription: Custom planning skill that overrides core');

  const content = loadContent({
    corePath: coreDir, userPath: userDir, projectPath: '/nonexistent', config: {}
  });

  assert.strictEqual(content.skills.length, 1);
  assert.strictEqual(content.skills[0].layer, 'user');
  assert.strictEqual(content.skills[0].overrides, true);

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 7: Non-override item has overrides = false
{
  const dir = mkTmpDir();
  createSkill(dir, 'unique', 'name: unique\ndescription: A unique skill that exists only in core layer');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  assert.strictEqual(content.skills[0].overrides, false);

  fs.rmSync(dir, { recursive: true });
}

console.log('  All loader-validation tests passed');
