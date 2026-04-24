#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { validateSkill, validateAgent, validateCommand, validateStructure } = require(
  path.join(__dirname, '..', 'scripts', 'validator.js')
);

// --- Skill validation ---

// Test 1: Valid skill passes
{
  const result = validateSkill({
    name: 'brainstorm',
    description: 'Collaborative ideation and design exploration for new features'
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
}

// Test 2: Skill missing name
{
  const result = validateSkill({
    description: 'A valid description that is long enough'
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('name')));
}

// Test 3: Skill missing description
{
  const result = validateSkill({
    name: 'my-skill'
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('description')));
}

// Test 4: Skill description too short
{
  const result = validateSkill({
    name: 'my-skill',
    description: 'Too short'
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('20')));
}

// Test 5: Skill with optional fields passes
{
  const result = validateSkill({
    name: 'my-skill',
    description: 'A description that meets the minimum length requirement',
    context_strategy: 'fresh',
    max_context_pct: '30',
    delegates_to: ['explorer', 'reviewer']
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.warnings.length, 0);
}

// Test 6: Skill with invalid context_strategy warns
{
  const result = validateSkill({
    name: 'my-skill',
    description: 'A description that meets the minimum length requirement',
    context_strategy: 'invalid'
  });
  assert.strictEqual(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('context_strategy')));
}

// --- Agent validation ---

// Test 7: Valid agent passes
{
  const result = validateAgent({
    name: 'explorer',
    description: 'Deep codebase analysis',
    model: 'sonnet',
    tools: ['Glob', 'Grep', 'Read']
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
}

// Test 8: Agent missing model
{
  const result = validateAgent({
    name: 'explorer',
    description: 'Deep codebase analysis',
    tools: ['Glob']
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('model')));
}

// Test 9: Agent missing tools
{
  const result = validateAgent({
    name: 'explorer',
    description: 'Analysis',
    model: 'sonnet'
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('tools')));
}

// Test 10: Agent with empty tools array
{
  const result = validateAgent({
    name: 'explorer',
    description: 'Analysis',
    model: 'sonnet',
    tools: []
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('tools')));
}

// Test 11: Agent with profile reference model passes
{
  const result = validateAgent({
    name: 'explorer',
    description: 'Analysis',
    model: '${profile.exploration}',
    tools: ['Read']
  });
  assert.strictEqual(result.valid, true);
}

// Test 12: Agent with invalid model fails
{
  const result = validateAgent({
    name: 'explorer',
    description: 'Analysis',
    model: 'gpt-4',
    tools: ['Read']
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('model')));
}

// --- Command validation ---

// Test 13: Valid command passes
{
  const result = validateCommand({
    name: 'fsd:validate',
    description: 'Check all content for schema compliance'
  });
  assert.strictEqual(result.valid, true);
}

// Test 14: Command without fsd: prefix warns
{
  const result = validateCommand({
    name: 'validate',
    description: 'Check all content for schema compliance'
  });
  assert.strictEqual(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('fsd:')));
}

// Test 15: Command missing name fails
{
  const result = validateCommand({
    description: 'Something'
  });
  assert.strictEqual(result.valid, false);
}

// --- Structure validation ---

// Test 16: undefined structure is valid (partial override, fully absent)
{
  const result = validateStructure(undefined);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
}

// Test 17: empty structure object is valid
{
  const result = validateStructure({});
  assert.strictEqual(result.valid, true);
}

// Test 18: valid partial structure passes
{
  const result = validateStructure({ skills: 'capabilities' });
  assert.strictEqual(result.valid, true);
}

// Test 19: valid full structure passes
{
  const result = validateStructure({ skills: 'a', agents: 'b', commands: 'c' });
  assert.strictEqual(result.valid, true);
}

// Test 20: unknown content kind rejected
{
  const result = validateStructure({ widgets: 'things' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('widgets')));
}

// Test 21: slash in value rejected
{
  const result = validateStructure({ skills: 'sub/dir' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('slash')));
}

// Test 22: backslash in value rejected
{
  const result = validateStructure({ skills: 'sub\\dir' });
  assert.strictEqual(result.valid, false);
}

// Test 23: leading-dot value rejected
{
  const result = validateStructure({ skills: '.hidden' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('.')));
}

// Test 24: empty string value rejected
{
  const result = validateStructure({ skills: '' });
  assert.strictEqual(result.valid, false);
}

// Test 25: non-string value rejected
{
  const result = validateStructure({ skills: 42 });
  assert.strictEqual(result.valid, false);
}

// Test 26: reserved name rejected
{
  const result = validateStructure({ skills: 'config.yaml' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('reserved')));
}

// Test 27: alias (two kinds sharing a value) rejected
{
  const result = validateStructure({ skills: 'shared', agents: 'shared' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('conflicts')));
}

// Test 28: array rejected (must be a mapping)
{
  const result = validateStructure(['a', 'b']);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('mapping')));
}

// --- Storage-kind extension (FSD-013) ---

// Test 29: validateStructure accepts spec/plan/research as known kinds
{
  const result = validateStructure({ spec: 'specifications', plan: 'plans', research: 'notes' });
  assert.strictEqual(result.valid, true, result.errors.join('; '));
}

// Test 30: aliases across scannable/storage kinds rejected (skills + spec same dir)
{
  const result = validateStructure({ skills: 'shared', spec: 'shared' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('conflicts')));
}

// Test 31: reserved-name check still applies to storage kinds
{
  const result = validateStructure({ spec: 'config.yaml' });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('reserved')));
}

// Test 32: SCANNABLE_KINDS and STORAGE_KINDS are disjoint and cover STRUCTURE_KEYS
{
  const { SCANNABLE_KINDS, STORAGE_KINDS, STRUCTURE_KEYS } = require(
    path.join(__dirname, '..', 'scripts', 'validator.js')
  );
  const overlap = SCANNABLE_KINDS.filter(k => STORAGE_KINDS.includes(k));
  assert.strictEqual(overlap.length, 0, 'scannable and storage kinds must be disjoint');
  const union = [...new Set([...SCANNABLE_KINDS, ...STORAGE_KINDS])];
  assert.deepStrictEqual(union.sort(), [...STRUCTURE_KEYS].sort());
}

// --- validateVerificationField (FSD-009) ---

// Test 33: validateVerificationField exported and accepts absent / empty object.
{
  const { validateVerificationField, VERIFICATION_SUBFIELDS } = require(
    path.join(__dirname, '..', 'scripts', 'validator.js'),
  );
  assert.strictEqual(typeof validateVerificationField, 'function');
  assert.deepStrictEqual(VERIFICATION_SUBFIELDS, ['tests', 'validate', 'typecheck', 'lint']);

  const absent = validateVerificationField({});
  assert.deepStrictEqual(absent, { errors: [], warnings: [] });

  const emptyObj = validateVerificationField({ verification: {} });
  assert.deepStrictEqual(emptyObj, { errors: [], warnings: [] });
}

// Test 34: validateVerificationField accepts all four known subfields.
{
  const { validateVerificationField } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
  const all = validateVerificationField({
    verification: { tests: 'npm t', validate: 'node v.js', typecheck: 'tsc', lint: 'eslint' },
  });
  assert.deepStrictEqual(all, { errors: [], warnings: [] });

  const partial = validateVerificationField({ verification: { tests: 'npm t' } });
  assert.deepStrictEqual(partial, { errors: [], warnings: [] });
}

// Test 35: validateVerificationField rejects non-object + empty-string subfields.
{
  const { validateVerificationField } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));

  const nonObj = validateVerificationField({ verification: 'npm test' });
  assert.ok(nonObj.errors.some(e => /mapping/i.test(e)));

  const arr = validateVerificationField({ verification: ['npm test'] });
  assert.ok(arr.errors.some(e => /mapping/i.test(e)));

  const empty = validateVerificationField({ verification: { tests: '' } });
  assert.ok(empty.errors.some(e => /verification\.tests/.test(e) && /non-empty/.test(e)));

  const numeric = validateVerificationField({ verification: { tests: 42 } });
  assert.ok(numeric.errors.some(e => /verification\.tests/.test(e)));
}

// Test 36: validateVerificationField warns on unknown subfield (forward-compat).
{
  const { validateVerificationField } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
  const r = validateVerificationField({ verification: { tests: 'npm t', extras: 'unknown' } });
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.warnings.some(w => /verification\.extras/.test(w) && /unknown/i.test(w)));
}

// Test 37: validateProject + validatePlan integrate the verification field.
{
  const { validateProject, validatePlan } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
  const baseProj = {
    project: 'P', id: 'p', title: 'P', status: 'active', created: '2026-04-24',
  };
  const basePlan = {
    project: 'P', id: 'p', title: 'P', status: 'draft', created: '2026-04-24',
  };

  // Happy path — both accept an object.
  assert.strictEqual(validateProject({ ...baseProj, verification: { tests: 'npm t' } }).valid, true);
  assert.strictEqual(validatePlan({ ...basePlan, verification: { tests: 'npm t' } }).valid, true);

  // Integration reject — non-object.
  assert.strictEqual(validateProject({ ...baseProj, verification: 'npm t' }).valid, false);
  assert.strictEqual(validatePlan({ ...basePlan, verification: 'npm t' }).valid, false);

  // Integration reject — empty-string subfield.
  const pEmpty = validateProject({ ...baseProj, verification: { tests: '' } });
  assert.strictEqual(pEmpty.valid, false);
  assert.ok(pEmpty.errors.some(e => /verification\.tests/.test(e)));

  const planEmpty = validatePlan({ ...basePlan, verification: { typecheck: '' } });
  assert.strictEqual(planEmpty.valid, false);
  assert.ok(planEmpty.errors.some(e => /verification\.typecheck/.test(e)));
}

console.log('  All validator tests passed');
