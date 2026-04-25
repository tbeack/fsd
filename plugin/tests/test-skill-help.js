#!/usr/bin/env node
'use strict';

// Structural tests for the /fsd:help skill (FSD-016).
//
// There is no backing script — the SKILL.md IS the deliverable.
// Tests assert that the file is present, has valid frontmatter, and
// covers all required content: the 8 skill names, overview section,
// deep-dive dispatch section, guardrails, and common patterns.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..');
const skillPath = path.join(pluginRoot, 'skills', 'help', 'SKILL.md');

const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

// ── Load the file once ────────────────────────────────────────────────────────

const raw = fs.readFileSync(skillPath, 'utf8');

// Split off YAML frontmatter (between first and second ---)
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
assert.ok(fmMatch, 'SKILL.md must have YAML frontmatter delimited by ---');
const frontmatter = parseYaml(fmMatch[1]);
const body = raw.slice(fmMatch[0].length);

// ── Frontmatter tests ─────────────────────────────────────────────────────────

console.log('\nFrontmatter');

test('file exists at plugin/skills/help/SKILL.md', () => {
  assert.ok(fs.existsSync(skillPath), `Expected file at ${skillPath}`);
});

test('frontmatter parses without error', () => {
  assert.ok(typeof frontmatter === 'object' && frontmatter !== null);
});

test('frontmatter.name equals "help"', () => {
  assert.strictEqual(frontmatter.name, 'fsd:help');
});

test('frontmatter.description is a non-empty string', () => {
  assert.ok(typeof frontmatter.description === 'string' && frontmatter.description.trim().length > 0);
});

test('frontmatter has argument-hint field', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(frontmatter, 'argument-hint'),
    'argument-hint key must be present');
  assert.ok(typeof frontmatter['argument-hint'] === 'string' && frontmatter['argument-hint'].trim().length > 0);
});

// ── Skill name coverage ───────────────────────────────────────────────────────

console.log('\nSkill name coverage');

const SKILL_NAMES = [
  'new-project',
  'roadmap',
  'spec',
  'spec-update',
  'plan',
  'plan-update',
  'execute-plan',
  'restructure',
];

for (const skill of SKILL_NAMES) {
  test(`body contains "${skill}"`, () => {
    assert.ok(body.includes(skill), `Expected "${skill}" to appear in SKILL.md body`);
  });
}

// ── Required sections ─────────────────────────────────────────────────────────

console.log('\nRequired sections');

test('overview section present (case-insensitive)', () => {
  assert.ok(
    /overview/i.test(body),
    'Expected an "Overview" section or heading in the body'
  );
});

test('deep-dive mode section present', () => {
  assert.ok(
    /deep.?dive/i.test(body),
    'Expected a "Deep-dive" section or equivalent in the body'
  );
});

test('guardrails section present', () => {
  assert.ok(
    /guardrail/i.test(body),
    'Expected a "Guardrails" section in the body'
  );
});

test('common patterns section present', () => {
  assert.ok(
    /common pattern/i.test(body),
    'Expected a "Common Patterns" section in the body'
  );
});

test('"Starting a new project" pattern present', () => {
  assert.ok(
    /starting a new project/i.test(body),
    'Expected "Starting a new project" in the Common Patterns section'
  );
});

test('"Adding a feature" pattern present', () => {
  assert.ok(
    /adding a feature/i.test(body),
    'Expected "Adding a feature" in the Common Patterns section'
  );
});

// ── Per-skill cheat sheets ────────────────────────────────────────────────────

console.log('\nPer-skill cheat sheets');

for (const skill of SKILL_NAMES) {
  test(`cheat sheet heading for /fsd:${skill} present`, () => {
    // Match ### /fsd:<name> or ### /fsd:<name> with any trailing text
    const re = new RegExp(`###\\s+/fsd:${skill}`, 'i');
    assert.ok(re.test(body), `Expected a "### /fsd:${skill}" cheat sheet heading`);
  });
}

// ── Template hygiene ──────────────────────────────────────────────────────────

console.log('\nTemplate hygiene');

test('no unfilled {{ }} template markers', () => {
  assert.ok(!raw.includes('{{'), 'Found unfilled {{ template marker');
  assert.ok(!raw.includes('}}'), 'Found unfilled }} template marker');
});

test('no-args dispatch documented (prints overview)', () => {
  assert.ok(
    /no.args|no args|without.*arg|\$ARGUMENTS.*empty|empty.*\$ARGUMENTS/i.test(body),
    'Expected documentation of the no-args → overview dispatch path'
  );
});

test('arg-dispatch documented (prints cheat sheet)', () => {
  // Should describe what happens when a skill name is passed
  assert.ok(
    /\$ARGUMENTS/i.test(body),
    'Expected $ARGUMENTS to be referenced in the dispatch logic'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
