#!/usr/bin/env node
'use strict';

// Unit + integration tests for the research authoring backing module (FSD-010).
// Covers: renderResearch (minimal/full/placeholder/skipped-section/sources/conclusion),
// writeResearchFile (happy path, refuse-to-overwrite, validation failure, config
// override, PROJECT.md auto-injection paths, round-trip via loader.scanArtifacts).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  renderResearch,
  writeResearchFile,
  resolveResearchPath,
  today,
  SECTION_ORDER,
  SECTION_META,
} = require(path.join(__dirname, '..', 'scripts', 'research.js'));
const { validateResearch } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { scanArtifacts } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));
const { writeProjectFiles } = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-research-'));
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  return parseYaml(m[1]);
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

// --- Exports + constants ---

// Test 1: Module exports and section constants are shaped correctly.
{
  assert.strictEqual(typeof renderResearch, 'function');
  assert.strictEqual(typeof writeResearchFile, 'function');
  assert.strictEqual(typeof resolveResearchPath, 'function');
  assert.strictEqual(typeof today, 'function');
  assert.deepStrictEqual(SECTION_ORDER, [
    'question', 'context', 'method', 'findings', 'conclusion', 'open_questions',
  ]);
  for (const id of SECTION_ORDER) {
    assert.ok(SECTION_META[id], `SECTION_META must include ${id}`);
    assert.strictEqual(typeof SECTION_META[id].heading, 'string');
    assert.strictEqual(typeof SECTION_META[id].placeholder, 'string');
  }
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
}

// --- renderResearch ---

// Test 2: Minimal input produces validateResearch-compliant frontmatter with all six headings.
{
  const out = renderResearch({ project: 'FSD', id: 'spike', title: 'Auth Spike' });
  const fm = extractFrontmatter(out);
  const v = validateResearch(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  assert.strictEqual(fm.project, 'FSD');
  assert.strictEqual(fm.id, 'spike');
  assert.strictEqual(fm.title, 'Auth Spike');
  assert.strictEqual(fm.status, 'draft', 'default status must be draft');
  assert.match(fm.created, /^\d{4}-\d{2}-\d{2}$/);
  // All six section headings appear.
  const headings = [...out.matchAll(/^##\s+(.+)$/gm)].map(m => m[1]);
  assert.deepStrictEqual(headings, [
    'Question', 'Context', 'Method', 'Findings', 'Conclusion', 'Open questions',
  ]);
  // Ends with exactly one newline.
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
}

// Test 3: Skipped sections retain their italicized placeholder copy.
{
  const out = renderResearch({ project: 'FSD', id: 'p', title: 'P' });
  for (const id of SECTION_ORDER) {
    const placeholder = SECTION_META[id].placeholder;
    assert.ok(out.includes(placeholder), `expected placeholder for ${id}: ${placeholder}`);
  }
}

// Test 4: User-provided sections replace placeholders; whitespace is trimmed.
{
  const out = renderResearch({
    project: 'FSD',
    id: 'custom',
    title: 'Custom',
    sections: {
      question: '   Is JWT better than session tokens?   ',
      findings: 'JWT has no server-side revocation without a denylist.',
    },
  });
  assert.ok(out.includes('\n## Question\n\nIs JWT better than session tokens?\n\n## Context'),
    `expected Question section with trimmed content; got:\n${out}`);
  assert.ok(out.includes('JWT has no server-side revocation without a denylist.'));
  // Placeholders for skipped sections still present.
  assert.ok(out.includes(SECTION_META.context.placeholder));
  assert.ok(out.includes(SECTION_META.method.placeholder));
}

// Test 5: sources emitted as YAML list when set; omitted when absent.
{
  const withSources = renderResearch({
    project: 'FSD', id: 's', title: 'S',
    sources: ['https://example.com/a', 'https://example.com/b'],
  });
  const fm = extractFrontmatter(withSources);
  assert.deepStrictEqual(fm.sources, ['https://example.com/a', 'https://example.com/b']);
  const v = validateResearch(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));

  const withoutSources = renderResearch({ project: 'FSD', id: 'ns', title: 'NS' });
  assert.ok(!withoutSources.match(/^sources:/m), 'sources must be omitted when not set');

  const emptySources = renderResearch({
    project: 'FSD', id: 'es', title: 'ES',
    sources: [],
  });
  assert.ok(!emptySources.match(/^sources:/m), 'empty sources array must be omitted');
}

// Test 6: conclusion emitted as scalar when set; omitted when absent.
{
  const withConclusion = renderResearch({
    project: 'FSD', id: 'c', title: 'C',
    conclusion: 'Use JWTs with short TTL and a denylist.',
  });
  const fm = extractFrontmatter(withConclusion);
  assert.strictEqual(fm.conclusion, 'Use JWTs with short TTL and a denylist.');
  const v = validateResearch(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));

  const withoutConclusion = renderResearch({ project: 'FSD', id: 'nc', title: 'NC' });
  assert.ok(!withoutConclusion.match(/^conclusion:/m), 'conclusion must be omitted when not set');

  const blankConclusion = renderResearch({
    project: 'FSD', id: 'bc', title: 'BC', conclusion: '   ',
  });
  assert.ok(!blankConclusion.match(/^conclusion:/m), 'blank conclusion must be omitted');
}

// Test 7: Full input (all optional fields) renders + validates.
{
  const out = renderResearch({
    project: 'FSD',
    id: 'full-spike',
    title: 'Full Spike',
    status: 'active',
    created: '2026-05-06',
    updated: '2026-05-06',
    related: ['spec/auth', 'plan/auth-impl'],
    tags: ['security', 'auth'],
    sources: ['https://jwt.io/introduction'],
    conclusion: 'JWTs are appropriate here.',
    sections: {
      question: 'Q', context: 'C', method: 'M',
      findings: 'F', conclusion: 'Conc', open_questions: 'O',
    },
  });
  const fm = extractFrontmatter(out);
  const v = validateResearch(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  assert.strictEqual(fm.status, 'active');
  assert.deepStrictEqual(fm.related, ['spec/auth', 'plan/auth-impl']);
  assert.deepStrictEqual(fm.tags, ['security', 'auth']);
  assert.deepStrictEqual(fm.sources, ['https://jwt.io/introduction']);
  assert.strictEqual(fm.conclusion, 'JWTs are appropriate here.');
}

// --- resolveResearchPath ---

// Test 8: resolveResearchPath honors default structure and config overrides.
{
  const a = resolveResearchPath({ projectPath: '/repo/.fsd', config: {}, id: 'my-spike' });
  assert.strictEqual(a, path.join('/repo/.fsd', 'research', 'my-spike.md'));

  const b = resolveResearchPath({
    projectPath: '/repo/.fsd',
    config: { structure: { research: 'investigations' } },
    id: 'bar',
  });
  assert.strictEqual(b, path.join('/repo/.fsd', 'investigations', 'bar.md'));
}

// --- writeResearchFile: happy path + round-trip ---

// Test 9: Happy path — writes to default structure.research, auto-injects project, round-trips.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  assert.strictEqual(seedProjectMd(planningDir).ok, true);

  const result = writeResearchFile({
    projectPath,
    planningDir,
    researchData: {
      id: 'jwt-investigation',
      title: 'JWT Investigation',
      sources: ['https://jwt.io'],
      sections: { question: 'Are JWTs safe?', findings: 'Yes, with caveats.' },
    },
  });

  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.written.length, 1);
  const expected = path.join(projectPath, 'research', 'jwt-investigation.md');
  assert.strictEqual(result.written[0], expected);
  assert.ok(fs.existsSync(expected));

  // project: auto-injected from PROJECT.md
  const written = fs.readFileSync(expected, 'utf-8');
  const fm = extractFrontmatter(written);
  assert.strictEqual(fm.project, 'Demo Project');
  assert.strictEqual(fm.id, 'jwt-investigation');

  // Round-trip via scanArtifacts
  const scanned = scanArtifacts({ fsdDir: projectPath, kind: 'research', dirName: 'research' });
  assert.strictEqual(scanned.length, 1);
  assert.strictEqual(scanned[0].id, 'jwt-investigation');
  assert.strictEqual(scanned[0].validation.valid, true, scanned[0].validation.errors.join('; '));

  fs.rmSync(root, { recursive: true });
}

// Test 10: Config override — structure.research renamed.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const result = writeResearchFile({
    projectPath,
    planningDir,
    config: { structure: { research: 'investigations' } },
    researchData: { id: 'renamed-dir', title: 'Renamed Dir' },
  });
  assert.strictEqual(result.ok, true, result.reason);
  const expected = path.join(projectPath, 'investigations', 'renamed-dir.md');
  assert.strictEqual(result.written[0], expected);
  assert.ok(fs.existsSync(expected));
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'research')), false);

  fs.rmSync(root, { recursive: true });
}

// --- writeResearchFile: refusal paths ---

// Test 11: Refuses to overwrite; on-disk content unchanged.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const first = writeResearchFile({
    projectPath, planningDir,
    researchData: { id: 'dup', title: 'Dup v1' },
  });
  assert.strictEqual(first.ok, true);
  const firstContent = fs.readFileSync(first.written[0], 'utf-8');

  const second = writeResearchFile({
    projectPath, planningDir,
    researchData: { id: 'dup', title: 'Dup v2 — should never win' },
  });
  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /refusing to overwrite/i);
  assert.deepStrictEqual(second.skipped, [path.join(projectPath, 'research', 'dup.md')]);
  assert.strictEqual(fs.readFileSync(first.written[0], 'utf-8'), firstContent);
  assert.ok(firstContent.includes('title: Dup v1'));

  fs.rmSync(root, { recursive: true });
}

// Test 12: Invalid frontmatter triggers pre-write validation failure; no file written.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  // Bad id (uppercase) fails validateResearch
  const result = writeResearchFile({
    projectPath, planningDir,
    researchData: { id: 'Bad-ID', title: 'Bad ID' },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /invalid frontmatter/i);
  assert.match(result.reason, /kebab-case/i);
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'research', 'Bad-ID.md')), false);
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'research')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 13: Missing required researchData fields produce clear reasons.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const noId = writeResearchFile({ projectPath, planningDir, researchData: { title: 'No id' } });
  assert.strictEqual(noId.ok, false);
  assert.match(noId.reason, /id is required/i);

  const noTitle = writeResearchFile({ projectPath, planningDir, researchData: { id: 'no-title' } });
  assert.strictEqual(noTitle.ok, false);
  assert.match(noTitle.reason, /title is required/i);

  assert.strictEqual(fs.existsSync(path.join(projectPath, 'research')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 14: Missing projectPath returns { ok: false }.
{
  const result = writeResearchFile({ projectPath: '', researchData: { id: 'x', title: 'X', project: 'P' } });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /projectPath is required/i);
}

// Test 15: Missing PROJECT.md without explicit project → refuses.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  // Do NOT seed planningDir.

  const result = writeResearchFile({
    projectPath, planningDir,
    researchData: { id: 'no-proj', title: 'No proj' },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /PROJECT\.md not found/i);
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'research')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 16: Caller-passed researchData.project bypasses PROJECT.md loader.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  // No PROJECT.md — but researchData.project is set.

  const result = writeResearchFile({
    projectPath, planningDir,
    researchData: { id: 'override', title: 'Override', project: 'Direct Injection' },
  });
  assert.strictEqual(result.ok, true, result.reason);
  const fm = extractFrontmatter(fs.readFileSync(result.written[0], 'utf-8'));
  assert.strictEqual(fm.project, 'Direct Injection');

  fs.rmSync(root, { recursive: true });
}

// Test 17: Pre-write validation failure leaves no tmp files on disk.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);
  fs.mkdirSync(path.join(projectPath, 'research'), { recursive: true });

  const result = writeResearchFile({
    projectPath, planningDir,
    researchData: {
      id: 'atomicity-check',
      title: 'Atomicity',
      // bad related ref → validateResearch rejects → write aborts
      related: ['not-a-valid-ref'],
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /invalid frontmatter/i);
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'research', 'atomicity-check.md')), false);
  const entries = fs.readdirSync(path.join(projectPath, 'research'));
  assert.strictEqual(entries.length, 0, `expected empty research dir; got ${entries.join(', ')}`);

  fs.rmSync(root, { recursive: true });
}

console.log('  All research tests passed');
