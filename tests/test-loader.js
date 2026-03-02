#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadContent } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-loader-'));
}

function writeSkill(baseDir, skillName, frontmatter) {
  const skillDir = path.join(baseDir, 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\nname: ${frontmatter.name}\ndescription: ${frontmatter.description}\n---\n\nSkill content for ${frontmatter.name}.`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
}

function writeAgent(baseDir, agentFile, frontmatter) {
  const agentsDir = path.join(baseDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const content = `---\nname: ${frontmatter.name}\ndescription: ${frontmatter.description}\n---\n\nAgent content for ${frontmatter.name}.`;
  fs.writeFileSync(path.join(agentsDir, agentFile), content);
}

function cleanUp(...dirs) {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true });
  }
}

// Test 1: Discovers skills from a single layer directory
{
  const coreDir = mkTmpDir();
  writeSkill(coreDir, 'code-review', { name: 'code-review', description: 'Review code changes' });
  writeSkill(coreDir, 'brainstorm', { name: 'brainstorm', description: 'Generate ideas' });

  const result = loadContent({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {} });
  assert.strictEqual(result.skills.length, 2);
  const names = result.skills.map(s => s.name).sort();
  assert.deepStrictEqual(names, ['brainstorm', 'code-review']);
  // Check .layer is set correctly
  for (const skill of result.skills) {
    assert.strictEqual(skill.layer, 'core');
  }

  cleanUp(coreDir);
}

// Test 2: Discovers agents from a single layer
{
  const coreDir = mkTmpDir();
  writeAgent(coreDir, 'explorer.md', { name: 'explorer', description: 'Explore codebases' });
  writeAgent(coreDir, 'planner.md', { name: 'planner', description: 'Plan work' });

  const result = loadContent({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {} });
  assert.strictEqual(result.agents.length, 2);
  const names = result.agents.map(a => a.name).sort();
  assert.deepStrictEqual(names, ['explorer', 'planner']);
  for (const agent of result.agents) {
    assert.strictEqual(agent.layer, 'core');
  }

  cleanUp(coreDir);
}

// Test 3: User layer shadows core when same skill name exists
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeSkill(coreDir, 'code-review', { name: 'code-review', description: 'Core code review' });
  writeSkill(userDir, 'code-review', { name: 'code-review', description: 'User code review' });

  const result = loadContent({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent', config: {} });
  assert.strictEqual(result.skills.length, 1);
  assert.strictEqual(result.skills[0].name, 'code-review');
  assert.strictEqual(result.skills[0].description, 'User code review');
  assert.strictEqual(result.skills[0].layer, 'user');

  cleanUp(coreDir, userDir);
}

// Test 4: Project layer shadows both user and core
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeSkill(coreDir, 'code-review', { name: 'code-review', description: 'Core version' });
  writeSkill(userDir, 'code-review', { name: 'code-review', description: 'User version' });
  writeSkill(projDir, 'code-review', { name: 'code-review', description: 'Project version' });

  const result = loadContent({ corePath: coreDir, userPath: userDir, projectPath: projDir, config: {} });
  assert.strictEqual(result.skills.length, 1);
  assert.strictEqual(result.skills[0].description, 'Project version');
  assert.strictEqual(result.skills[0].layer, 'project');

  cleanUp(coreDir, userDir, projDir);
}

// Test 5: Unique names from all layers all appear
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeSkill(coreDir, 'brainstorm', { name: 'brainstorm', description: 'Core brainstorm' });
  writeSkill(coreDir, 'debug', { name: 'debug', description: 'Core debug' });
  writeSkill(userDir, 'my-skill', { name: 'my-skill', description: 'User custom skill' });
  writeSkill(projDir, 'proj-skill', { name: 'proj-skill', description: 'Project skill' });

  const result = loadContent({ corePath: coreDir, userPath: userDir, projectPath: projDir, config: {} });
  assert.strictEqual(result.skills.length, 4);
  const names = result.skills.map(s => s.name).sort();
  assert.deepStrictEqual(names, ['brainstorm', 'debug', 'my-skill', 'proj-skill']);

  cleanUp(coreDir, userDir, projDir);
}

// Test 6: Disabled content is filtered out
{
  const coreDir = mkTmpDir();
  writeSkill(coreDir, 'brainstorm', { name: 'brainstorm', description: 'Generate ideas' });
  writeSkill(coreDir, 'debug', { name: 'debug', description: 'Debug issues' });
  writeAgent(coreDir, 'explorer.md', { name: 'explorer', description: 'Explore code' });

  const config = { disabled: ['skills/brainstorm', 'agents/explorer'] };
  const result = loadContent({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent', config });
  assert.strictEqual(result.skills.length, 1);
  assert.strictEqual(result.skills[0].name, 'debug');
  assert.strictEqual(result.agents.length, 0);

  cleanUp(coreDir);
}

// Test 7: Nonexistent directories return empty arrays gracefully
{
  const result = loadContent({ corePath: '/nonexistent', userPath: '/nonexistent', projectPath: '/nonexistent', config: {} });
  assert.deepStrictEqual(result.skills, []);
  assert.deepStrictEqual(result.agents, []);
}

console.log('  All loader tests passed');
