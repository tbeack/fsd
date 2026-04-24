#!/usr/bin/env node
'use strict';

// Unit + integration tests for the architecture backing module (FSD-008).
// Covers: validateArchitecture; parseArchitecture; renderArchitecture;
// createArchitectureFile (happy / refuse-to-overwrite / PROJECT.md missing /
// atomicity); appendDecision (newest-first prepending, placeholder strip,
// updated-bump, byte-preservation, refuse-if-missing); appendToSection
// (placeholder-strip + append, unknown section refusal, refuse-if-missing,
// refuse-decisions-via-wrong-op); round-trip stability.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArchitecture,
  renderArchitecture,
  createArchitectureFile,
  appendDecision,
  appendToSection,
  today,
  ARCHITECTURE_FILENAME,
  SECTION_ORDER,
  SECTION_META,
} = require(path.join(__dirname, '..', 'scripts', 'architecture.js'));
const { validateArchitecture } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));
const { writeProjectFiles } = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-arch-'));
}

function seedProjectMd(planningDir, projectName = 'Demo Project') {
  return writeProjectFiles({
    planningDir,
    projectData: { project: projectName, id: 'demo-project', title: projectName, vision: 'demo' },
    roadmapData: {
      project: projectName,
      id: 'demo-project-roadmap',
      title: `${projectName} Roadmap`,
      version: '0.1',
      current_milestone: 'v1',
    },
  });
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  return parseYaml(m[1]);
}

// --- Exports + constants ---

// Test 1: module exports and section constants are shaped correctly.
{
  assert.strictEqual(typeof parseArchitecture, 'function');
  assert.strictEqual(typeof renderArchitecture, 'function');
  assert.strictEqual(typeof createArchitectureFile, 'function');
  assert.strictEqual(typeof appendDecision, 'function');
  assert.strictEqual(typeof appendToSection, 'function');
  assert.strictEqual(ARCHITECTURE_FILENAME, 'ARCHITECTURE.md');
  assert.deepStrictEqual(SECTION_ORDER, [
    'stack', 'decisions', 'code_examples', 'references', 'standards', 'glossary', 'open_questions',
  ]);
  for (const id of SECTION_ORDER) {
    assert.ok(SECTION_META[id], `SECTION_META must include ${id}`);
    assert.strictEqual(typeof SECTION_META[id].heading, 'string');
    assert.strictEqual(typeof SECTION_META[id].placeholder, 'string');
  }
}

// --- validateArchitecture ---

// Test 2: minimal valid architecture frontmatter passes.
{
  const v = validateArchitecture({
    project: 'Demo', id: 'architecture', title: 'Demo Architecture',
    status: 'active', created: '2026-04-24',
  });
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  assert.deepStrictEqual(v.errors, []);
}

// Test 3: missing required fields fail.
{
  for (const missing of ['project', 'id', 'title', 'status', 'created']) {
    const meta = { project: 'D', id: 'architecture', title: 'T', status: 'active', created: '2026-04-24' };
    delete meta[missing];
    const v = validateArchitecture(meta);
    assert.strictEqual(v.valid, false, `missing ${missing} should fail`);
  }
}

// Test 4: validateArchitecture enforces kebab-case + enum + ISO date.
{
  const bad1 = validateArchitecture({ project: 'D', id: 'Not_Kebab', title: 'T', status: 'active', created: '2026-04-24' });
  assert.strictEqual(bad1.valid, false);
  const bad2 = validateArchitecture({ project: 'D', id: 'ok', title: 'T', status: 'bogus', created: '2026-04-24' });
  assert.strictEqual(bad2.valid, false);
  const bad3 = validateArchitecture({ project: 'D', id: 'ok', title: 'T', status: 'active', created: '2026/04/24' });
  assert.strictEqual(bad3.valid, false);
}

// --- renderArchitecture ---

// Test 5: minimal data produces a full 7-section doc with placeholders.
{
  const out = renderArchitecture({ project: 'Demo', title: 'Demo Architecture' });
  assert.match(out, /^---\n/);
  const fm = extractFrontmatter(out);
  assert.strictEqual(fm.project, 'Demo');
  assert.strictEqual(fm.id, 'architecture');
  assert.strictEqual(fm.title, 'Demo Architecture');
  assert.strictEqual(fm.status, 'active');
  assert.match(fm.created, /^\d{4}-\d{2}-\d{2}$/);
  for (const id of SECTION_ORDER) {
    const heading = SECTION_META[id].heading;
    const placeholder = SECTION_META[id].placeholder;
    assert.ok(out.includes(`## ${heading}`), `missing heading ${heading}`);
    assert.ok(out.includes(placeholder), `missing placeholder for ${id}`);
  }
}

// Test 6: user-provided section content replaces placeholders.
{
  const out = renderArchitecture({
    project: 'Demo',
    title: 'Demo Architecture',
    sections: { stack: 'Node 20+' },
  });
  assert.ok(out.includes('Node 20+'));
  assert.ok(!out.includes(SECTION_META.stack.placeholder));
  // Other sections retain their placeholders.
  assert.ok(out.includes(SECTION_META.decisions.placeholder));
}

// --- parseArchitecture ---

// Test 7: parseArchitecture recognizes all 7 canonical sections.
{
  const content = renderArchitecture({ project: 'Demo', title: 'Demo Architecture' });
  const p = parseArchitecture(content);
  assert.strictEqual(p.frontmatter.project, 'Demo');
  assert.deepStrictEqual(p.sections.map(s => s.id), SECTION_ORDER);
}

// Test 8: parseArchitecture tolerates unknown headings (id: null).
{
  const content = [
    '---',
    'project: Demo',
    'id: architecture',
    'title: Demo',
    'status: active',
    'created: 2026-04-24',
    '---',
    '',
    '# Demo',
    '',
    '## Stack & Technical Details',
    '',
    'stuff',
    '',
    '## My Random Section',
    '',
    'user content',
    '',
  ].join('\n');
  const p = parseArchitecture(content);
  const headings = p.sections.map(s => ({ id: s.id, heading: s.heading }));
  assert.deepStrictEqual(headings, [
    { id: 'stack', heading: 'Stack & Technical Details' },
    { id: null, heading: 'My Random Section' },
  ]);
}

// Test 9: malformed frontmatter throws.
{
  assert.throws(() => parseArchitecture('not frontmatter'), /does not begin with/);
  assert.throws(() => parseArchitecture('---\nno closing\n'), /unterminated frontmatter/);
}

// --- createArchitectureFile ---

// Test 10: happy path — writes a new file at planning/ARCHITECTURE.md.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir, 'Demo Project');

  const res = createArchitectureFile({ planningDir, architectureData: {} });
  assert.strictEqual(res.ok, true, res.reason);
  const target = path.join(planningDir, 'ARCHITECTURE.md');
  assert.deepStrictEqual(res.written, [target]);
  const content = fs.readFileSync(target, 'utf-8');
  const fm = extractFrontmatter(content);
  assert.strictEqual(fm.project, 'Demo Project'); // auto-injected
  assert.strictEqual(fm.title, 'Demo Project Architecture'); // default title
}

// Test 11: refuses to overwrite an existing file — byte-preserved.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  const first = createArchitectureFile({ planningDir, architectureData: {} });
  assert.strictEqual(first.ok, true);
  const target = path.join(planningDir, 'ARCHITECTURE.md');
  const before = fs.readFileSync(target, 'utf-8');

  const second = createArchitectureFile({ planningDir, architectureData: { project: 'OtherProject', title: 'Rogue' } });
  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /refusing to overwrite/);
  const after = fs.readFileSync(target, 'utf-8');
  assert.strictEqual(after, before, 'file must be byte-preserved');
}

// Test 12: refuses when PROJECT.md is missing.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  const res = createArchitectureFile({ planningDir, architectureData: {} });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /PROJECT\.md not found/);
  assert.ok(!fs.existsSync(path.join(planningDir, 'ARCHITECTURE.md')));
}

// Test 13: accepts an explicit project (bypasses auto-inject).
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  const res = createArchitectureFile({
    planningDir,
    architectureData: { project: 'DirectProj', title: 'Custom Title' },
  });
  assert.strictEqual(res.ok, true);
  const fm = extractFrontmatter(fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8'));
  assert.strictEqual(fm.project, 'DirectProj');
  assert.strictEqual(fm.title, 'Custom Title');
}

// --- appendDecision ---

// Test 14: appendDecision strips the placeholder and lands the first ADR.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });

  const res = appendDecision({
    planningDir,
    title: 'Use atomic writes',
    context: 'Concurrent readers',
    decision: 'tmp + rename',
    consequences: 'No partial files',
  });
  assert.strictEqual(res.ok, true, res.reason);

  const content = fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8');
  assert.ok(!content.includes(SECTION_META.decisions.placeholder), 'placeholder should be gone');
  assert.match(content, /### \d{4}-\d{2}-\d{2} — Use atomic writes/);
  assert.match(content, /\*\*Context:\*\* Concurrent readers/);
  assert.match(content, /\*\*Decision:\*\* tmp \+ rename/);
  assert.match(content, /\*\*Consequences:\*\* No partial files/);

  const fm = extractFrontmatter(content);
  assert.strictEqual(fm.updated, today());
}

// Test 15: newest-first — second appendDecision lands above the first.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  appendDecision({ planningDir, title: 'First', context: 'c1', decision: 'd1', consequences: 'q1', date: '2026-01-01' });
  appendDecision({ planningDir, title: 'Second', context: 'c2', decision: 'd2', consequences: 'q2', date: '2026-02-02' });

  const content = fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8');
  const idxFirst = content.indexOf('First');
  const idxSecond = content.indexOf('Second');
  assert.ok(idxSecond !== -1 && idxFirst !== -1);
  assert.ok(idxSecond < idxFirst, 'newest entry must appear first');
}

// Test 16: appendDecision refuses when ARCHITECTURE.md is missing.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  const res = appendDecision({
    planningDir, title: 't', context: 'c', decision: 'd', consequences: 'q',
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /not found/);
}

// Test 17: appendDecision requires all four entry fields.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  const res = appendDecision({ planningDir, title: 'only title' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /required/);
}

// Test 18: appendDecision preserves other sections byte-for-byte.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  appendToSection({ planningDir, sectionId: 'standards', content: 'Use 2-space indentation.' });
  const target = path.join(planningDir, 'ARCHITECTURE.md');
  const before = fs.readFileSync(target, 'utf-8');
  const standardsBefore = before.match(/## Standards[\s\S]*?(?=## Glossary)/)[0];

  appendDecision({ planningDir, title: 'T', context: 'c', decision: 'd', consequences: 'q' });
  const after = fs.readFileSync(target, 'utf-8');
  const standardsAfter = after.match(/## Standards[\s\S]*?(?=## Glossary)/)[0];
  assert.strictEqual(standardsAfter, standardsBefore, 'unrelated sections must be byte-preserved');
}

// --- appendToSection ---

// Test 19: first append to a section replaces the placeholder.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });

  const res = appendToSection({ planningDir, sectionId: 'stack', content: 'Node 20+' });
  assert.strictEqual(res.ok, true, res.reason);
  const content = fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8');
  assert.ok(content.includes('Node 20+'));
  assert.ok(!content.includes(SECTION_META.stack.placeholder));
  const fm = extractFrontmatter(content);
  assert.strictEqual(fm.updated, today());
}

// Test 20: subsequent appends land after existing content without clobber.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  appendToSection({ planningDir, sectionId: 'stack', content: 'First entry' });
  appendToSection({ planningDir, sectionId: 'stack', content: 'Second entry' });
  const content = fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8');
  assert.ok(content.includes('First entry'));
  assert.ok(content.includes('Second entry'));
  assert.ok(content.indexOf('First entry') < content.indexOf('Second entry'));
  // No triple blank lines.
  assert.ok(!/\n\n\n\n/.test(content), 'must not accumulate triple blanks');
}

// Test 21: appendToSection refuses unknown section id.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  const res = appendToSection({ planningDir, sectionId: 'not-real', content: 'x' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /unknown section/);
}

// Test 22: appendToSection refuses the `decisions` id with a pointer to appendDecision.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  const res = appendToSection({ planningDir, sectionId: 'decisions', content: 'x' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /appendDecision/);
}

// Test 23: appendToSection refuses when ARCHITECTURE.md is missing.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  const res = appendToSection({ planningDir, sectionId: 'stack', content: 'x' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /not found/);
}

// --- round-trip stability ---

// Test 24: multi-op sequence keeps the file valid and parseable.
{
  const tmp = mkTmpDir();
  const planningDir = path.join(tmp, 'planning');
  fs.mkdirSync(planningDir);
  seedProjectMd(planningDir);
  createArchitectureFile({ planningDir, architectureData: {} });
  appendDecision({ planningDir, title: 'A', context: 'a', decision: 'a', consequences: 'a' });
  appendToSection({ planningDir, sectionId: 'stack', content: 'node' });
  appendToSection({ planningDir, sectionId: 'references', content: 'https://example.com' });
  appendDecision({ planningDir, title: 'B', context: 'b', decision: 'b', consequences: 'b' });

  const content = fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8');
  const parsed = parseArchitecture(content);
  const validation = validateArchitecture(parsed.frontmatter);
  assert.strictEqual(validation.valid, true, validation.errors.join('; '));
  // All 7 canonical sections still present and ordered.
  assert.deepStrictEqual(parsed.sections.map(s => s.id), SECTION_ORDER);
}

console.log('  All architecture tests passed');
