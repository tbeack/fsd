#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));

// Test 1: Simple key-value pairs
{
  const input = `
skills_dir: "./my-skills"
agents_dir: "./agents"
workflow: my-workflow
`;
  const result = parseYaml(input);
  assert.strictEqual(result.skills_dir, './my-skills');
  assert.strictEqual(result.agents_dir, './agents');
  assert.strictEqual(result.workflow, 'my-workflow');
}

// Test 2: Array values with - syntax
{
  const input = `
disabled:
  - "skills/brainstorm"
  - "agents/explorer"
required:
  - "skills/code-review"
`;
  const result = parseYaml(input);
  assert.deepStrictEqual(result.disabled, ['skills/brainstorm', 'agents/explorer']);
  assert.deepStrictEqual(result.required, ['skills/code-review']);
}

// Test 3: Comments and blank lines are ignored
{
  const input = `
# This is a comment
workflow: plan-execute-verify

# Another comment
disabled:
  - "skills/brainstorm"
`;
  const result = parseYaml(input);
  assert.strictEqual(result.workflow, 'plan-execute-verify');
  assert.deepStrictEqual(result.disabled, ['skills/brainstorm']);
}

// Test 4: Empty input returns empty object
{
  const result = parseYaml('');
  assert.deepStrictEqual(result, {});
}

// Test 5: Mixed keys and arrays
{
  const input = `
workflow: custom
disabled:
  - "skills/brainstorm"
skills_dir: "./custom-skills"
required:
  - "skills/review"
  - "skills/test"
`;
  const result = parseYaml(input);
  assert.strictEqual(result.workflow, 'custom');
  assert.strictEqual(result.skills_dir, './custom-skills');
  assert.deepStrictEqual(result.disabled, ['skills/brainstorm']);
  assert.deepStrictEqual(result.required, ['skills/review', 'skills/test']);
}

// Test 6: Quoted and unquoted values
{
  const input = `
key1: "quoted value"
key2: 'single quoted'
key3: unquoted value
`;
  const result = parseYaml(input);
  assert.strictEqual(result.key1, 'quoted value');
  assert.strictEqual(result.key2, 'single quoted');
  assert.strictEqual(result.key3, 'unquoted value');
}

console.log('  All yaml-parser tests passed');
