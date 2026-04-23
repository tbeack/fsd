# FSD v0.2 Implementation Plan — Foundation Hardening

**Goal:** Make the FSD core robust enough for teams to build on. Add schema validation, strategic config merge, enhanced list output, and a validate command. All changes are backward-compatible with v0.1.

**Prerequisite:** v0.1 is fully implemented (yaml-parser, config, loader, init, add, list, SessionStart hook, 5 skills, 2 agents, 3 commands, 6 test files).

**Architecture reference:** `planning/2026-03-02-fsd-framework-design.md` (revised 2026-03-26)

**Tech Stack:** Same as v0.1 — Node.js 18+ (zero npm dependencies), bash for hook entry, YAML config files.

**TDD protocol:** Every task writes the failing test first, then the implementation, then verifies.

---

## What v0.2 Delivers

1. **Schema validation** for skills, agents, and commands at discovery time
2. **Strategic config merge** — arrays concatenate with dedup, objects merge recursively, `!replace` override
3. **Enhanced `/fsd:list`** — shows validation status, override indicators, layer source
4. **New `/fsd:validate` command** — full schema compliance report across all layers
5. **SessionStart hook update** — shows validation warning count
6. **YAML parser extension** — support for nested objects (required for `workflows` and `model_profiles` config keys)

---

## Final File Changes

```
Modified:
  scripts/yaml-parser.js          # Add nested object support
  scripts/config.js               # Strategic merge (deep merge + array concat)
  scripts/loader.js               # Add validation pass after discovery
  scripts/list.js                 # Show validation status + override indicators
  scripts/session-start-loader.js # Show validation warning count
  scripts/add.js                  # Generate templates with all required fields
  tests/test-yaml-parser.js       # New tests for nested objects
  tests/test-config.js            # New tests for deep merge + array concat + !replace

New:
  scripts/validator.js            # Schema definitions + validation logic
  tests/test-validator.js         # Validator unit tests
  tests/test-loader-validation.js # Loader + validator integration tests
  commands/validate.md            # /fsd:validate command
```

---

## Task 1: Extend YAML Parser for Nested Objects

The current `parseYaml()` handles flat key-value pairs and string arrays only. Config keys like `workflows`, `model_profiles`, and `conventions` require one level of nested object support.

**Files:**
- Modify: `scripts/yaml-parser.js`
- Modify: `tests/test-yaml-parser.js`

**Step 1: Write the failing tests**

Append to `tests/test-yaml-parser.js`, before the final `console.log`:

```js
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

// Test 10: Empty nested object followed by next key
{
  const input = `
conventions:
workflow: plan-execute-verify
`;
  const result = parseYaml(input);
  // 'conventions' has no indented children, 'workflow' is a top-level key
  assert.strictEqual(result.workflow, 'plan-execute-verify');
}
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-yaml-parser.js`
Expected: FAIL — nested objects parsed incorrectly

**Step 3: Update `parseYaml()` in `scripts/yaml-parser.js`**

Replace the `parseYaml` function with logic that detects indented `key: value` lines (2+ spaces before the key) as nested object entries. The parser should:

1. Track a `currentKey` and `currentMode` (null, 'array', or 'object')
2. When a line starts with `- ` and `currentMode === 'array'`, push to the array
3. When a line has leading whitespace and contains `key: value`, and `currentMode === 'object'`, add to the nested object
4. When a non-indented `key:` line is encountered with an empty value, check the next indented line to determine if it's an array (`- `) or object (`key: value`)
5. When a non-indented `key: value` line is encountered, reset `currentKey`

Key constraint: Only one level of nesting. No recursion needed. Values in nested objects are always strings.

**Step 4: Run tests to verify they pass**

Run: `node tests/test-yaml-parser.js`
Expected: `All yaml-parser tests passed`

**Step 5: Run full test suite**

Run: `bash tests/run-tests.sh`
Expected: All existing tests still pass

**Step 6: Commit**

```bash
git add scripts/yaml-parser.js tests/test-yaml-parser.js
git commit -m "feat: extend YAML parser with nested object support"
```

---

## Task 2: Strategic Config Merge

Replace the current shallow merge in `config.js` with strategic merge: scalars last-writer-wins, arrays concatenate with dedup, objects merge recursively, `!replace` suffix forces full replacement.

**Files:**
- Modify: `scripts/config.js`
- Modify: `tests/test-config.js`

**Step 1: Write the failing tests**

Append to `tests/test-config.js`, before the final `console.log`:

```js
// Test 6: Arrays concatenate with dedup (not replace)
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'disabled:\n  - "skills/brainstorm"\n  - "skills/debug"');
  writeYaml(userDir, 'disabled:\n  - "skills/verify"\n  - "skills/debug"');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  // Concatenate + dedup: [brainstorm, debug, verify]
  assert.strictEqual(config.disabled.length, 3);
  assert.ok(config.disabled.includes('skills/brainstorm'));
  assert.ok(config.disabled.includes('skills/debug'));
  assert.ok(config.disabled.includes('skills/verify'));

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 7: Objects merge recursively
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'conventions:\n  commit_style: conventional\n  test_before_complete: true');
  writeYaml(userDir, 'conventions:\n  commit_style: gitmoji');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  assert.strictEqual(config.conventions.commit_style, 'gitmoji');
  assert.strictEqual(config.conventions.test_before_complete, 'true');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 8: !replace suffix forces full replacement for arrays
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'disabled:\n  - "skills/brainstorm"\n  - "skills/debug"');
  writeYaml(userDir, 'disabled!replace:\n  - "skills/verify"');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  assert.deepStrictEqual(config.disabled, ['skills/verify']);

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 9: Scalar values still last-writer-wins
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: core-flow');
  writeYaml(userDir, 'workflow: user-flow');
  writeYaml(projDir, 'workflow: project-flow');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: projDir });
  assert.strictEqual(config.workflow, 'project-flow');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}
```

**Step 2: Run tests to verify they fail**

Run: `node tests/test-config.js`
Expected: Test 6 fails (arrays currently replace, not concatenate)

**Step 3: Update `loadConfig()` in `scripts/config.js`**

Replace the shallow spread (`{ ...merged, ...parsed }`) with a `strategicMerge(target, source)` function:

```
function strategicMerge(target, source):
  for each key in source:
    // Handle !replace suffix
    if key ends with '!replace':
      realKey = key without '!replace'
      target[realKey] = source[key]  // Full replacement
      continue

    if key not in target:
      target[key] = source[key]
    else if both are arrays:
      target[key] = dedupConcat(target[key], source[key])
    else if both are plain objects:
      target[key] = strategicMerge(target[key], source[key])
    else:
      target[key] = source[key]  // Scalar: last writer wins

  return target
```

Helper: `dedupConcat(a, b)` returns `[...new Set([...a, ...b])]`.

Export `strategicMerge` for direct testing if needed.

**Step 4: Update existing Test 5**

The existing Test 5 expects shallow array replacement. Update it to expect concatenation behavior, or convert it to use `!replace` to maintain the original intent.

**Step 5: Run tests**

Run: `node tests/test-config.js`
Expected: `All config tests passed`

Run: `bash tests/run-tests.sh`
Expected: All tests pass

**Step 6: Commit**

```bash
git add scripts/config.js tests/test-config.js
git commit -m "feat: strategic config merge — array concat, deep object merge, !replace override"
```

---

## Task 3: Content Schema Validator

A new module that defines schemas for each content type and validates parsed frontmatter against them. Returns structured results (errors and warnings) without throwing.

**Files:**
- Create: `scripts/validator.js`
- Create: `tests/test-validator.js`

**Step 1: Write the failing test**

```js
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
  assert.strictEqual(result.valid, true); // Warnings don't invalidate
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
  assert.strictEqual(result.valid, true); // Warning, not error
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
```

Write to `tests/test-validator.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-validator.js`
Expected: FAIL with `Cannot find module`

**Step 3: Implement `scripts/validator.js`**

```
Module exports: validateSkill(meta), validateAgent(meta), validateCommand(meta)

Each returns: { valid: boolean, errors: string[], warnings: string[] }

Skill schema:
  - name: required, non-empty string
  - description: required, string, min 20 chars
  - context_strategy: optional, must be one of ['fresh', 'shared', 'minimal']
  - max_context_pct: optional, must be parseable as number 1-100
  - delegates_to: optional, must be array of strings

Agent schema:
  - name: required, non-empty string
  - description: required, non-empty string
  - model: required, must be one of ['sonnet', 'opus', 'haiku'] OR match /^\$\{profile\.\w+\}$/
  - tools: required, non-empty array of strings
  - color: optional, string

Command schema:
  - name: required, non-empty string
  - description: required, non-empty string
  - name should start with 'fsd:' (warning if not)
  - argument-hint: optional, string
```

**Step 4: Run tests**

Run: `node tests/test-validator.js`
Expected: `All validator tests passed`

Run: `bash tests/run-tests.sh`
Expected: All tests pass

**Step 5: Commit**

```bash
git add scripts/validator.js tests/test-validator.js
git commit -m "feat: add content schema validator for skills, agents, and commands"
```

---

## Task 4: Integrate Validation into Loader

Wire the validator into `loader.js` so every discovered skill/agent gets validated at scan time. Validation results are attached to each content item. Invalid content still loads (with errors/warnings attached).

**Files:**
- Modify: `scripts/loader.js`
- Create: `tests/test-loader-validation.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadContent } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

function createSkill(baseDir, name, frontmatter) {
  const skillDir = path.join(baseDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
    `---\n${frontmatter}\n---\n\n# ${name}\n\nContent.`);
}

function createAgent(baseDir, name, frontmatter) {
  fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'agents', `${name}.md`),
    `---\n${frontmatter}\n---\n\nAgent content.`);
}

// Test 1: Valid skill has validation.valid = true
{
  const dir = mkTmpDir();
  createSkill(dir, 'plan', 'name: plan\ndescription: Turn design into ordered task list before coding');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const skill = content.skills[0];
  assert.strictEqual(skill.validation.valid, true);
  assert.strictEqual(skill.validation.errors.length, 0);

  fs.rmSync(dir, { recursive: true });
}

// Test 2: Skill with short description has validation error
{
  const dir = mkTmpDir();
  createSkill(dir, 'bad', 'name: bad\ndescription: Too short');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const skill = content.skills[0];
  assert.strictEqual(skill.validation.valid, false);
  assert.ok(skill.validation.errors.length > 0);
  // Still loaded despite validation failure
  assert.strictEqual(skill.name, 'bad');

  fs.rmSync(dir, { recursive: true });
}

// Test 3: Agent missing model has validation error
{
  const dir = mkTmpDir();
  createAgent(dir, 'broken', 'name: broken\ndescription: Test agent');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const agent = content.agents[0];
  assert.strictEqual(agent.validation.valid, false);
  assert.ok(agent.validation.errors.some(e => e.includes('model')));

  fs.rmSync(dir, { recursive: true });
}

// Test 4: Valid agent passes validation
{
  const dir = mkTmpDir();
  createAgent(dir, 'good',
    'name: good\ndescription: A good agent\nmodel: sonnet\ntools:\n  - Read\n  - Grep');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  const agent = content.agents[0];
  assert.strictEqual(agent.validation.valid, true);

  fs.rmSync(dir, { recursive: true });
}

// Test 5: loadContent returns validationSummary
{
  const dir = mkTmpDir();
  createSkill(dir, 'good', 'name: good\ndescription: A perfectly valid skill description here');
  createSkill(dir, 'bad', 'name: bad\ndescription: Short');
  createAgent(dir, 'ok', 'name: ok\ndescription: OK agent\nmodel: sonnet\ntools:\n  - Read');

  const content = loadContent({
    corePath: dir, userPath: '/nonexistent', projectPath: '/nonexistent', config: {}
  });

  assert.strictEqual(content.validationSummary.total, 3);
  assert.strictEqual(content.validationSummary.valid, 2);
  assert.strictEqual(content.validationSummary.invalid, 1);

  fs.rmSync(dir, { recursive: true });
}

console.log('  All loader-validation tests passed');
```

Write to `tests/test-loader-validation.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-loader-validation.js`
Expected: FAIL — `validation` property doesn't exist on content items

**Step 3: Update `scripts/loader.js`**

Changes:
1. Import `validateSkill` and `validateAgent` from `validator.js`
2. In `scanSkills()`, after extracting frontmatter, call `validateSkill(meta)` and attach result as `validation` property
3. In `scanAgents()`, after extracting frontmatter, call `validateAgent(meta)` and attach result as `validation` property
4. In `loadContent()`, after filtering, compute `validationSummary`:
   ```js
   const all = [...skills, ...agents];
   const validationSummary = {
     total: all.length,
     valid: all.filter(i => i.validation.valid).length,
     invalid: all.filter(i => !i.validation.valid).length,
     warnings: all.reduce((sum, i) => sum + i.validation.warnings.length, 0)
   };
   ```
5. Return `{ skills, agents, validationSummary }`

**Step 4: Run tests**

Run: `node tests/test-loader-validation.js`
Expected: `All loader-validation tests passed`

Run: `bash tests/run-tests.sh`
Expected: All tests pass (including original loader tests — verify no regressions)

**Step 5: Commit**

```bash
git add scripts/loader.js tests/test-loader-validation.js
git commit -m "feat: integrate schema validation into content loader"
```

---

## Task 5: Enhanced `/fsd:list` Output

Update the list command to show validation status and override indicators.

**Files:**
- Modify: `scripts/list.js`
- Modify: `tests/test-list.js`

**Step 1: Design the new output format**

```
SKILLS (5 active, 1 warning)
  NAME                 LAYER       STATUS   DESCRIPTION
  brainstorm           user [>]    ok       Collaborative ideation and design...
  plan                 core        ok       Turn design into ordered task lis...
  execute              core        ok       Implement plan task-by-task with...
  bad-skill            project     2 err    Missing required fields
  debug                core        ok       Systematically diagnose and fix...

AGENTS (2 active)
  NAME                 LAYER       STATUS   DESCRIPTION
  explorer             core        ok       Deep codebase analysis
  reviewer             core        ok       Code review for correctness and...

Layers: core (...) | user (~/.fsd/) | project (.fsd/)
[>] = overrides a lower layer
Commands: /fsd:list, /fsd:add, /fsd:init, /fsd:validate
```

Key changes from v0.1:
- `STATUS` column: `ok`, `N warn`, `N err`
- `[>]` indicator when content shadows a lower layer
- Validation summary in section header
- `/fsd:validate` added to commands list

**Step 2: Update tests in `tests/test-list.js`**

Add tests that verify:
1. Output includes `STATUS` column
2. Invalid content shows error count
3. Override indicator `[>]` appears for shadowed content
4. Validation summary in header

**Step 3: Update `scripts/list.js`**

1. Accept `validation` property on each content item
2. Format status column based on `item.validation.valid`, `item.validation.errors.length`, `item.validation.warnings.length`
3. To detect overrides, `loadContent()` needs to expose which items shadow lower layers. Add an `overrides` boolean to content items in `loader.js` (set to `true` when a `Map.set()` call overwrites an existing entry).
4. Add `[>]` suffix to layer name when `item.overrides === true`

**Step 4: Run tests**

Run: `node tests/test-list.js`
Expected: `All list tests passed`

Run: `bash tests/run-tests.sh`
Expected: All tests pass

**Step 5: Commit**

```bash
git add scripts/list.js scripts/loader.js tests/test-list.js
git commit -m "feat: enhanced /fsd:list with validation status and override indicators"
```

---

## Task 6: `/fsd:validate` Command

A new command that runs full schema validation across all layers and outputs a detailed report.

**Files:**
- Create: `commands/validate.md`
- Create: `scripts/validate.js`

**Step 1: Create the command file**

```markdown
---
name: fsd:validate
description: Check all content across all layers for schema compliance
argument-hint: "[--all|--skills|--agents|--commands]"
---

Run schema validation on all FSD content across all three layers (core, user, project).

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js $CLAUDE_PLUGIN_ROOT $ARGUMENTS`

Report the output to the user exactly as printed.
```

Write to `commands/validate.md`.

**Step 2: Create the validation script**

`scripts/validate.js` should:

1. Load config and content using existing modules
2. Output a formatted report:

```
FSD Validation Report
=====================

SKILLS (5 checked)
  ok    brainstorm           core
  ok    plan                 core
  ok    execute              core
  ok    verify               core
  ERR   bad-skill            project   name: required; description: must be >= 20 chars

AGENTS (2 checked)
  ok    explorer             core
  WARN  reviewer             core      color: recommended for agent display

COMMANDS (4 checked)
  ok    fsd:init             core
  ok    fsd:add              core
  ok    fsd:list             core
  ok    fsd:validate         core

Summary: 11 checked, 10 valid, 1 error, 1 warning
```

3. Support `--skills`, `--agents`, `--commands` flags to filter output
4. Exit code 0 if no errors, 1 if any errors found

**Step 3: Validate commands too**

The current loader doesn't scan commands. Add a `scanCommands()` function to `loader.js` that:
1. Scans `commands/` directories across all layers
2. Extracts frontmatter from `.md` files
3. Validates against `validateCommand()` from `validator.js`
4. Returns array with same shape as skills/agents

Update `loadContent()` to also return `commands` in the result.

**Step 4: Run tests**

Run: `bash tests/run-tests.sh`
Expected: All tests pass

Manual test: Run `/fsd:validate` in a Claude Code session to verify output format.

**Step 5: Commit**

```bash
git add commands/validate.md scripts/validate.js scripts/loader.js
git commit -m "feat: add /fsd:validate command for schema compliance checking"
```

---

## Task 7: Update SessionStart Hook

Show validation warning count in the session start output so users are aware of issues without running `/fsd:validate`.

**Files:**
- Modify: `scripts/session-start-loader.js`

**Step 1: Update the output format**

After the skills/agents listing, before the layers line, add:

```
VALIDATION: 1 error, 2 warnings (run /fsd:validate for details)
```

Only show this line if there are errors or warnings. If everything is clean, show nothing (keep it quiet).

**Step 2: Update the script**

In `session-start-loader.js`:
1. The `validationSummary` is already returned by `loadContent()` (from Task 4)
2. Check `validationSummary.invalid > 0 || validationSummary.warnings > 0`
3. If so, append the validation line

**Step 3: Verify**

Manual test: Create a skill with a short description in `~/.fsd/skills/`, start a new session, verify the warning appears.

**Step 4: Commit**

```bash
git add scripts/session-start-loader.js
git commit -m "feat: show validation warnings in SessionStart output"
```

---

## Task 8: Update `/fsd:add` Templates

Ensure generated templates include all required fields with valid defaults so new content passes validation out of the box.

**Files:**
- Modify: `scripts/add.js`
- Modify: `tests/test-add.js`

**Step 1: Update skill template**

Current template may have a short description placeholder. Update to:

```markdown
---
name: {name}
description: This skill should be used when the user asks to "{name}". Customize this description to define when the skill triggers.
---

# {Name}

## Overview
[Describe what this skill does]

## Process
### 1. First Step
[Instructions]

### 2. Second Step
[Instructions]

## Output
[Describe expected output]
```

The description placeholder is 80+ chars, passing the 20-char minimum.

**Step 2: Update agent template**

```markdown
---
name: {name}
description: |
  Use this agent when the user needs {name} analysis.
  <example>
  Context: User needs {name} assistance
  user: "Can you help with {name}?"
  assistant: "I'll use the {name} agent to help."
  <commentary>Trigger when {name} analysis is needed.</commentary>
  </example>
model: sonnet
tools:
  - Glob
  - Grep
  - Read
color: cyan
---

You are a specialized {name} agent. [Customize this system prompt.]
```

All required fields (`model`, `tools`) are present with valid defaults.

**Step 3: Update command template**

```markdown
---
name: fsd:{name}
description: [Describe what this command does — be specific about when to use it]
---

[Command implementation instructions]
```

Name includes `fsd:` prefix by default.

**Step 4: Update tests**

In `tests/test-add.js`, add assertions that:
1. Generated skill template passes `validateSkill()`
2. Generated agent template passes `validateAgent()`
3. Generated command template passes `validateCommand()`

**Step 5: Run tests**

Run: `bash tests/run-tests.sh`
Expected: All tests pass

**Step 6: Commit**

```bash
git add scripts/add.js tests/test-add.js
git commit -m "feat: update /fsd:add templates to pass schema validation"
```

---

## Task 9: Update plugin.json Version

**Files:**
- Modify: `.claude-plugin/plugin.json`

**Step 1: Update version to 0.2.0**

Change `"version": "0.1.0"` to `"version": "0.2.0"`.

Update description to reflect new capabilities:
```json
"description": "Full Stack Development — a multi-layer meta-framework for Claude Code with schema-validated skills, agents, and commands"
```

**Step 2: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "chore: bump version to 0.2.0"
```

---

## Task 10: Integration Verification

Run the full test suite and manually verify the end-to-end flow.

**Step 1: Run all tests**

```bash
bash tests/run-tests.sh
```

Expected: All tests pass (should be 9+ test files).

**Step 2: Manual verification checklist**

- [ ] Start a new Claude Code session — SessionStart hook shows skills/agents with validation count
- [ ] `/fsd:list` shows STATUS column with ok/err/warn
- [ ] `/fsd:list` shows `[>]` for overridden content
- [ ] `/fsd:validate` produces full report
- [ ] `/fsd:add skill test-skill` creates a template that passes validation
- [ ] `/fsd:add agent test-agent` creates a template that passes validation
- [ ] `/fsd:add command test-cmd` creates a template that passes validation
- [ ] Create a skill with short description — validation reports error
- [ ] Config with arrays merges correctly across layers (concatenate, not replace)
- [ ] Config with `!replace` suffix forces full replacement

**Step 3: Final commit (if any fixes needed)**

Fix any issues found, add tests for the fix, commit individually.

---

## Summary

| Task | Files Changed | Description |
|------|--------------|-------------|
| 1 | yaml-parser.js, test-yaml-parser.js | Nested object support |
| 2 | config.js, test-config.js | Strategic merge (array concat, deep merge, !replace) |
| 3 | validator.js, test-validator.js | Schema definitions + validation logic |
| 4 | loader.js, test-loader-validation.js | Wire validation into content discovery |
| 5 | list.js, loader.js, test-list.js | Enhanced output with validation + overrides |
| 6 | validate.md, validate.js, loader.js | New /fsd:validate command |
| 7 | session-start-loader.js | Validation warnings at session start |
| 8 | add.js, test-add.js | Templates pass validation out of the box |
| 9 | plugin.json | Version bump to 0.2.0 |
| 10 | — | Integration verification |
