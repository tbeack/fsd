#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { validateSkill, validateAgent, validateCommand } = require(
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

console.log('  All validator tests passed');
