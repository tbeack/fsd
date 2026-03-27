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

// Test 7: Nested object (one level deep)
{
  const input = `
conventions:
  commit_style: conventional
  test_before_complete: true
workflow: plan-execute-verify
`;
  const result = parseYaml(input);
  assert.strictEqual(result.workflow, 'plan-execute-verify');
  assert.deepStrictEqual(result.conventions, {
    commit_style: 'conventional',
    test_before_complete: 'true'
  });
}

// Test 8: Nested object followed by array
{
  const input = `
conventions:
  commit_style: conventional
disabled:
  - "skills/brainstorm"
  - "skills/debug"
`;
  const result = parseYaml(input);
  assert.deepStrictEqual(result.conventions, { commit_style: 'conventional' });
  assert.deepStrictEqual(result.disabled, ['skills/brainstorm', 'skills/debug']);
}

// Test 9: Multiple nested objects
{
  const input = `
model_profiles:
  planning: opus
  execution: sonnet
  review: haiku
conventions:
  commit_style: conventional
`;
  const result = parseYaml(input);
  assert.deepStrictEqual(result.model_profiles, {
    planning: 'opus',
    execution: 'sonnet',
    review: 'haiku'
  });
  assert.deepStrictEqual(result.conventions, { commit_style: 'conventional' });
}

// Test 10: Empty block key followed by next top-level key
{
  const input = `
conventions:
workflow: plan-execute-verify
`;
  const result = parseYaml(input);
  assert.strictEqual(result.workflow, 'plan-execute-verify');
}

// Test 11: Multi-line text block with |
{
  const input = `
description: |
  This is a multi-line
  text block value
name: test
`;
  const result = parseYaml(input);
  assert.ok(result.description.includes('This is a multi-line'));
  assert.ok(result.description.includes('text block value'));
  assert.strictEqual(result.name, 'test');
}

// Test 12: Inline flow array ["a", "b"]
{
  const input = `
tools: ["Glob", "Grep", "Read"]
name: explorer
`;
  const result = parseYaml(input);
  assert.deepStrictEqual(result.tools, ['Glob', 'Grep', 'Read']);
  assert.strictEqual(result.name, 'explorer');
}

// Test 13: Inline flow array with single quotes
{
  const input = `
tools: ['Read', 'Write']
`;
  const result = parseYaml(input);
  assert.deepStrictEqual(result.tools, ['Read', 'Write']);
}

// Test 14: Empty inline flow array
{
  const input = `
tools: []
`;
  const result = parseYaml(input);
  assert.deepStrictEqual(result.tools, []);
}

console.log('  All yaml-parser tests passed');
