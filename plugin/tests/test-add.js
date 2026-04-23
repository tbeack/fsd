#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { addContent } = require(path.join(__dirname, '..', 'scripts', 'add.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

// Test 1: Creates a skill in user space
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'skill', name: 'my-review', userPath: userDir, project: false });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(userDir, 'skills', 'my-review', 'SKILL.md')), true);

  const content = fs.readFileSync(path.join(userDir, 'skills', 'my-review', 'SKILL.md'), 'utf-8');
  assert.ok(content.includes('name: my-review'));
  assert.ok(content.includes('description:'));

  fs.rmSync(userDir, { recursive: true });
}

// Test 2: Creates a skill in project space with --project
{
  const projDir = mkTmpDir();
  fs.mkdirSync(path.join(projDir, '.fsd'), { recursive: true });

  const result = addContent({ type: 'skill', name: 'team-lint', projectPath: path.join(projDir, '.fsd'), project: true });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(projDir, '.fsd', 'skills', 'team-lint', 'SKILL.md')), true);

  fs.rmSync(projDir, { recursive: true });
}

// Test 3: Creates an agent in user space
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'agent', name: 'my-linter', userPath: userDir, project: false });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(userDir, 'agents', 'my-linter.md')), true);

  const content = fs.readFileSync(path.join(userDir, 'agents', 'my-linter.md'), 'utf-8');
  assert.ok(content.includes('name: my-linter'));

  fs.rmSync(userDir, { recursive: true });
}

// Test 4: Creates a command in user space
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'command', name: 'deploy', userPath: userDir, project: false });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(userDir, 'commands', 'deploy.md')), true);

  fs.rmSync(userDir, { recursive: true });
}

// Test 5: Rejects invalid type
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'widget', name: 'foo', userPath: userDir, project: false });

  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('Invalid type'));

  fs.rmSync(userDir, { recursive: true });
}

// Test 6: Does not overwrite existing content
{
  const userDir = mkTmpDir();
  addContent({ type: 'skill', name: 'existing', userPath: userDir, project: false });

  // Write custom content
  const skillPath = path.join(userDir, 'skills', 'existing', 'SKILL.md');
  fs.writeFileSync(skillPath, 'custom content');

  const result = addContent({ type: 'skill', name: 'existing', userPath: userDir, project: false });
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('already exists'));

  // Original preserved
  assert.strictEqual(fs.readFileSync(skillPath, 'utf-8'), 'custom content');

  fs.rmSync(userDir, { recursive: true });
}

// Test 7: Generated skill template passes validation
{
  const { validateSkill } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
  const { extractFrontmatter } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));

  const userDir = mkTmpDir();
  addContent({ type: 'skill', name: 'test-valid', userPath: userDir, project: false });

  const content = fs.readFileSync(path.join(userDir, 'skills', 'test-valid', 'SKILL.md'), 'utf-8');
  const fm = extractFrontmatter(content);
  const result = validateSkill(fm);
  assert.strictEqual(result.valid, true, `Skill template should pass validation: ${result.errors.join(', ')}`);

  fs.rmSync(userDir, { recursive: true });
}

// Test 8: Generated agent template passes validation
{
  const { validateAgent } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
  const { extractFrontmatter } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));

  const userDir = mkTmpDir();
  addContent({ type: 'agent', name: 'test-valid', userPath: userDir, project: false });

  const content = fs.readFileSync(path.join(userDir, 'agents', 'test-valid.md'), 'utf-8');
  const fm = extractFrontmatter(content);
  const result = validateAgent(fm);
  assert.strictEqual(result.valid, true, `Agent template should pass validation: ${result.errors.join(', ')}`);

  fs.rmSync(userDir, { recursive: true });
}

// Test 9: Generated command template passes validation
{
  const { validateCommand } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
  const { extractFrontmatter } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));

  const userDir = mkTmpDir();
  addContent({ type: 'command', name: 'test-valid', userPath: userDir, project: false });

  const content = fs.readFileSync(path.join(userDir, 'commands', 'test-valid.md'), 'utf-8');
  const fm = extractFrontmatter(content);
  const result = validateCommand(fm);
  assert.strictEqual(result.valid, true, `Command template should pass validation: ${result.errors.join(', ')}`);

  fs.rmSync(userDir, { recursive: true });
}

// Test 10: addContent routes skill to custom structure dir
{
  const projDir = mkTmpDir();
  fs.mkdirSync(path.join(projDir, '.fsd'), { recursive: true });

  const result = addContent({
    type: 'skill',
    name: 'my-cap',
    projectPath: path.join(projDir, '.fsd'),
    project: true,
    config: { structure: { skills: 'capabilities' } },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(projDir, '.fsd', 'capabilities', 'my-cap', 'SKILL.md')), true);
  assert.strictEqual(fs.existsSync(path.join(projDir, '.fsd', 'skills', 'my-cap', 'SKILL.md')), false);

  fs.rmSync(projDir, { recursive: true });
}

// Test 11: addContent routes agent + command to custom structure dirs
{
  const projDir = mkTmpDir();
  fs.mkdirSync(path.join(projDir, '.fsd'), { recursive: true });
  const config = { structure: { agents: 'bots', commands: 'actions' } };

  addContent({ type: 'agent', name: 'a1', projectPath: path.join(projDir, '.fsd'), project: true, config });
  addContent({ type: 'command', name: 'c1', projectPath: path.join(projDir, '.fsd'), project: true, config });

  assert.strictEqual(fs.existsSync(path.join(projDir, '.fsd', 'bots', 'a1.md')), true);
  assert.strictEqual(fs.existsSync(path.join(projDir, '.fsd', 'actions', 'c1.md')), true);

  fs.rmSync(projDir, { recursive: true });
}

console.log('  All add tests passed');
