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

// Test 8: Loader reads skills from a custom structure directory name
{
  const coreDir = mkTmpDir();
  // Write a skill into a "capabilities" dir instead of "skills"
  const skillDir = path.join(coreDir, 'capabilities', 'my-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: my-skill\ndescription: A skill in a renamed dir for testing purposes\n---\n\nbody`,
  );

  const config = { structure: { skills: 'capabilities' } };
  const result = loadContent({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent', config });
  assert.strictEqual(result.skills.length, 1);
  assert.strictEqual(result.skills[0].name, 'my-skill');

  // Sanity: without the override, the same tree finds nothing under 'skills/'
  const resultDefault = loadContent({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {} });
  assert.strictEqual(resultDefault.skills.length, 0);

  cleanUp(coreDir);
}

// Test 9: Loader reads agents + commands from custom structure dirs
{
  const coreDir = mkTmpDir();
  fs.mkdirSync(path.join(coreDir, 'bots'), { recursive: true });
  fs.writeFileSync(
    path.join(coreDir, 'bots', 'helper.md'),
    `---\nname: helper\ndescription: helper agent\nmodel: sonnet\ntools: ["Read"]\n---\nbody`,
  );
  fs.mkdirSync(path.join(coreDir, 'actions'), { recursive: true });
  fs.writeFileSync(
    path.join(coreDir, 'actions', 'go.md'),
    `---\nname: fsd:go\ndescription: do a thing\n---\nbody`,
  );

  const config = { structure: { agents: 'bots', commands: 'actions' } };
  const result = loadContent({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent', config });
  assert.strictEqual(result.agents.length, 1);
  assert.strictEqual(result.agents[0].name, 'helper');
  assert.strictEqual(result.commands.length, 1);
  assert.strictEqual(result.commands[0].name, 'fsd:go');

  cleanUp(coreDir);
}

// Test 10: Different layers can declare different structure names (structure from config wins — not per-layer)
// Confirms the implementation reads structure once from the merged config, not per-layer.
{
  const coreDir = mkTmpDir();
  const projDir = mkTmpDir();
  // Core stores skills under 'skills/'; project stores them under 'capabilities/'
  writeSkill(coreDir, 'core-thing', { name: 'core-thing', description: 'a core skill in the default skills dir' });
  const projSkillDir = path.join(projDir, 'capabilities', 'proj-thing');
  fs.mkdirSync(projSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(projSkillDir, 'SKILL.md'),
    `---\nname: proj-thing\ndescription: a project skill in capabilities dir\n---\nbody`,
  );

  // With structure override → only capabilities/ is scanned, so core/skills/ is invisible
  const result = loadContent({
    corePath: coreDir,
    userPath: '/nonexistent',
    projectPath: projDir,
    config: { structure: { skills: 'capabilities' } },
  });
  const names = result.skills.map(s => s.name).sort();
  assert.deepStrictEqual(names, ['proj-thing']);

  cleanUp(coreDir, projDir);
}

// Test 11: Loader does NOT scan storage kinds (spec/plan/research)
// Defensive regression test: even if someone drops a SKILL.md under one of the
// storage dirs, the loader must not activate it as a skill.
{
  const coreDir = mkTmpDir();
  for (const storageKind of ['spec', 'plan', 'research']) {
    const dir = path.join(coreDir, storageKind, 'fake-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: fake-skill-in-${storageKind}\ndescription: should never be picked up by the loader\n---\nbody`,
    );
  }
  const result = loadContent({
    corePath: coreDir,
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {},
  });
  assert.strictEqual(result.skills.length, 0, 'storage kinds must be invisible to the loader');
  cleanUp(coreDir);
}

console.log('  All loader tests passed');
