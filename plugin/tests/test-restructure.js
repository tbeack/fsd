#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  previewRestructure,
  applyRestructure,
  rewriteConfigStructure,
  findStaleReferences,
} = require(path.join(__dirname, '..', 'scripts', 'restructure.js'));
const { initProject } = require(path.join(__dirname, '..', 'scripts', 'init.js'));
const { addContent } = require(path.join(__dirname, '..', 'scripts', 'add.js'));
const { loadContent } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const { loadConfig, DEFAULT_STRUCTURE } = require(path.join(__dirname, '..', 'scripts', 'config.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-restructure-'));
}

// Helper: create a fixture .fsd project at tmpDir, optionally with some skills/agents/commands
function setupFixture(tmpDir, opts = {}) {
  initProject(tmpDir);
  const projectPath = path.join(tmpDir, '.fsd');
  if (opts.withSkill) {
    addContent({ type: 'skill', name: opts.withSkill, projectPath, project: true });
  }
  if (opts.withAgent) {
    addContent({ type: 'agent', name: opts.withAgent, projectPath, project: true });
  }
  if (opts.withCommand) {
    addContent({ type: 'command', name: opts.withCommand, projectPath, project: true });
  }
  return tmpDir;
}

// --- previewRestructure ---

// Test 1: preview with no renames is a clean no-op
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = previewRestructure({ projectPath: tmpDir, renames: {} });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.renameOps.length, 0);
  assert.strictEqual(result.errors.length, 0);
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 2: preview of valid single rename succeeds
{
  const tmpDir = setupFixture(mkTmpDir(), { withSkill: 'sample' });
  const result = previewRestructure({ projectPath: tmpDir, renames: { skills: 'capabilities' } });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.renameOps.length, 1);
  assert.strictEqual(result.renameOps[0].from, 'skills');
  assert.strictEqual(result.renameOps[0].to, 'capabilities');
  assert.strictEqual(result.renameOps[0].physicalRename, true);
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 3: preview rejects unknown kind
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = previewRestructure({ projectPath: tmpDir, renames: { widgets: 'things' } });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('widgets')));
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 4: preview rejects reserved names
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = previewRestructure({ projectPath: tmpDir, renames: { skills: 'config.yaml' } });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('reserved')));
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 5: preview rejects aliases (two kinds renamed to same dir)
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = previewRestructure({
    projectPath: tmpDir,
    renames: { skills: 'shared', agents: 'shared' },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('conflicts')));
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 6: preview rejects rename to existing directory
{
  const tmpDir = setupFixture(mkTmpDir());
  fs.mkdirSync(path.join(tmpDir, '.fsd', 'preexisting'), { recursive: true });
  const result = previewRestructure({
    projectPath: tmpDir,
    renames: { skills: 'preexisting' },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('already exists')));
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 7: preview finds stale references in content files
{
  const tmpDir = setupFixture(mkTmpDir(), { withSkill: 'sample' });
  // Inject a markdown file that mentions 'skills/' in its body
  const notePath = path.join(tmpDir, '.fsd', 'skills', 'sample', 'NOTE.md');
  fs.writeFileSync(notePath, 'This skill lives under `skills/` and delegates to it.\n');
  const result = previewRestructure({
    projectPath: tmpDir,
    renames: { skills: 'capabilities' },
  });
  assert.strictEqual(result.ok, true);
  assert.ok(result.staleReferences.length > 0, 'expected stale references');
  const note = result.staleReferences.find(r => r.path === notePath);
  assert.ok(note, 'expected NOTE.md flagged');
  fs.rmSync(tmpDir, { recursive: true });
}

// --- applyRestructure ---

// Test 8: apply renames the physical directory and updates config
{
  const tmpDir = setupFixture(mkTmpDir(), { withSkill: 'sample' });
  const result = applyRestructure({
    projectPath: tmpDir,
    renames: { skills: 'capabilities' },
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'capabilities', 'sample', 'SKILL.md')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills')), false);

  const config = loadConfig({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath: path.join(tmpDir, '.fsd'),
  });
  assert.strictEqual(config.structure.skills, 'capabilities');
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 9: loader still finds content after apply (end-to-end)
{
  const tmpDir = setupFixture(mkTmpDir(), { withSkill: 'sample', withAgent: 'helper' });
  applyRestructure({
    projectPath: tmpDir,
    renames: { skills: 'capabilities', agents: 'bots' },
  });

  const projectPath = path.join(tmpDir, '.fsd');
  const config = loadConfig({ corePath: '/nonexistent', userPath: '/nonexistent', projectPath });
  const content = loadContent({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath,
    config,
  });
  const skillNames = content.skills.map(s => s.name);
  const agentNames = content.agents.map(a => a.name);
  assert.ok(skillNames.includes('sample'), `expected skill 'sample' after rename, got ${skillNames}`);
  assert.ok(agentNames.includes('helper'), `expected agent 'helper' after rename, got ${agentNames}`);
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 10: apply fails cleanly (no partial state) when errors present
{
  const tmpDir = setupFixture(mkTmpDir(), { withSkill: 'sample' });
  const result = applyRestructure({
    projectPath: tmpDir,
    renames: { skills: 'config.yaml' },
  });
  assert.strictEqual(result.success, false);
  // Nothing moved
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills', 'sample')), true);
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 11: apply is idempotent when rename is a no-op (already renamed)
{
  const tmpDir = setupFixture(mkTmpDir(), { withSkill: 'sample' });
  applyRestructure({ projectPath: tmpDir, renames: { skills: 'capabilities' } });
  // Second apply with the same target — config already says capabilities, disk already at capabilities
  const result = applyRestructure({ projectPath: tmpDir, renames: { skills: 'capabilities' } });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.preview.renameOps.length, 0, 'expected no-op on second apply');
  fs.rmSync(tmpDir, { recursive: true });
}

// --- rewriteConfigStructure ---

// Test 12: rewriteConfigStructure replaces an existing block
{
  const input = `workflow: plan\nstructure:\n  skills: old\n  # comment\nconventions:\n  x: y\n`;
  const output = rewriteConfigStructure(input, { skills: 'new', agents: 'agents', commands: 'commands' });
  assert.ok(output.includes('skills: new'));
  assert.ok(!output.includes('skills: old'));
  assert.ok(output.includes('conventions:'), 'downstream keys preserved');
}

// Test 13: rewriteConfigStructure appends a block when missing
{
  const input = `workflow: plan\n`;
  const output = rewriteConfigStructure(input, { ...DEFAULT_STRUCTURE, skills: 'caps' });
  assert.ok(output.includes('structure:'));
  assert.ok(output.includes('skills: caps'));
  assert.ok(output.startsWith('workflow: plan\n'));
}

// Test 14: rewriteConfigStructure writes only non-default keys
{
  const input = `workflow: plan\n`;
  const output = rewriteConfigStructure(input, { ...DEFAULT_STRUCTURE });
  // All defaults — no explicit keys written, only commented example for every kind
  assert.ok(!/^\s*skills: skills/m.test(output));
  assert.ok(output.includes('# skills: skills'));
  assert.ok(output.includes('# spec: spec'));
  assert.ok(output.includes('# research: research'));
}

// --- findStaleReferences ---

// Test 15: findStaleReferences handles missing dir gracefully
{
  const result = findStaleReferences('/nonexistent/path/to/fsd', ['skills']);
  assert.deepStrictEqual(result, []);
}

// Test 16: findStaleReferences matches bounded occurrences only
{
  const tmpDir = mkTmpDir();
  const fsdDir = path.join(tmpDir, '.fsd');
  fs.mkdirSync(fsdDir, { recursive: true });
  const a = path.join(fsdDir, 'with-ref.md');
  const b = path.join(fsdDir, 'without-ref.md');
  fs.writeFileSync(a, 'This mentions `skills/foo` in a code span.\n');
  fs.writeFileSync(b, 'This talks about skillset and skillsware but not the dir.\n');
  const hits = findStaleReferences(fsdDir, ['skills']);
  const paths = hits.map(h => h.path);
  assert.ok(paths.includes(a));
  assert.ok(!paths.includes(b), 'should not match substrings inside unrelated words');
  fs.rmSync(tmpDir, { recursive: true });
}

// --- Storage-kind rename (FSD-013) ---

// Test 17: apply renames a storage-kind directory end-to-end
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = applyRestructure({
    projectPath: tmpDir,
    renames: { spec: 'specifications' },
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'specifications')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'spec')), false);
  // .gitkeep moved with the rename
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'specifications', '.gitkeep')), true);

  const config = loadConfig({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath: path.join(tmpDir, '.fsd'),
  });
  assert.strictEqual(config.structure.spec, 'specifications');
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 18: preview rejects rename that creates an alias across scannable+storage kinds
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = previewRestructure({
    projectPath: tmpDir,
    renames: { skills: 'shared', spec: 'shared' },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('conflicts')));
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 19: preview handles rename of multiple kinds across both classes
{
  const tmpDir = setupFixture(mkTmpDir());
  const result = previewRestructure({
    projectPath: tmpDir,
    renames: { skills: 'capabilities', plan: 'plans' },
  });
  assert.strictEqual(result.ok, true);
  const kinds = result.renameOps.map(op => op.kind).sort();
  assert.deepStrictEqual(kinds, ['plan', 'skills']);
  fs.rmSync(tmpDir, { recursive: true });
}

console.log('  All restructure tests passed');
