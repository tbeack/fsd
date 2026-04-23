# FSD Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the FSD Claude Code plugin — a three-layer meta-framework for organizing skills, agents, and commands with upgrade-safe customization.

**Architecture:** Plugin uses Claude Code's native auto-discovery for core content (skills/, agents/, commands/ in plugin root). A SessionStart hook runs Node.js scripts that scan all three layers (core `${CLAUDE_PLUGIN_ROOT}`, user `~/.fsd/`, project `.fsd/`), resolve name shadowing by priority, apply config cascades, and inject the resolved content map into Claude's context. Commands are thin `.md` prompts that delegate to Node.js scripts for logic.

**Tech Stack:** Claude Code plugin system, Node.js 18+ (zero npm dependencies, built-in `fs`, `path`, `assert`), bash for hook entry points, YAML config files

---

## Final Directory Structure

```
fsd/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── brainstorm/
│   │   └── SKILL.md
│   ├── plan/
│   │   └── SKILL.md
│   ├── execute/
│   │   └── SKILL.md
│   ├── verify/
│   │   └── SKILL.md
│   └── debug/
│       └── SKILL.md
├── agents/
│   ├── explorer.md
│   └── reviewer.md
├── commands/
│   ├── init.md
│   ├── list.md
│   └── add.md
├── hooks/
│   ├── hooks.json
│   └── scripts/
│       └── session-start.sh
├── scripts/
│   ├── yaml-parser.js
│   ├── config.js
│   ├── loader.js
│   ├── list.js
│   ├── add.js
│   └── init.js
├── tests/
│   ├── run-tests.sh
│   ├── test-yaml-parser.js
│   ├── test-config.js
│   ├── test-loader.js
│   ├── test-list.js
│   ├── test-add.js
│   └── test-init.js
└── docs/
    └── plans/
        ├── 2026-03-02-fsd-framework-design.md
        └── 2026-03-02-fsd-implementation-plan.md
```

---

## Task 1: Plugin Scaffold + Test Harness

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `tests/run-tests.sh`
- Create: `.gitignore`

**Step 1: Create the plugin manifest**

```json
{
  "name": "fsd",
  "description": "Full Stack Development — a three-layer meta-framework for Claude Code that organizes skills, agents, and commands with upgrade-safe customization",
  "version": "0.1.0",
  "author": {
    "name": "Theo Beack"
  },
  "license": "MIT",
  "keywords": ["framework", "skills", "agents", "commands", "workflow", "meta-framework"]
}
```

Write to `.claude-plugin/plugin.json`.

**Step 2: Create the test runner**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
ERRORS=""

for test_file in "$SCRIPT_DIR"/test-*.js; do
  test_name="$(basename "$test_file" .js)"
  if node "$test_file" 2>&1; then
    PASS=$((PASS + 1))
    echo "PASS  $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL  $test_name"
    echo "FAIL  $test_name"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo -e "\nFailures:$ERRORS"
  exit 1
fi
```

Write to `tests/run-tests.sh`.

**Step 3: Create .gitignore**

```
node_modules/
.DS_Store
*.log
```

Write to `.gitignore`.

**Step 4: Create placeholder directories**

```bash
mkdir -p skills agents commands hooks/scripts scripts tests
```

**Step 5: Run test runner to verify it works (no tests yet = passes)**

Run: `bash tests/run-tests.sh`
Expected: `Results: 0 passed, 0 failed`

**Step 6: Commit**

```bash
git add .claude-plugin/plugin.json tests/run-tests.sh .gitignore
git commit -m "feat: scaffold FSD plugin with manifest and test harness"
```

---

## Task 2: YAML Parser Utility

A minimal YAML parser handling the exact subset FSD configs use: flat key-value pairs, string arrays with `- item` syntax, comments, and blank lines. No nested objects, no multi-line strings, no anchors.

**Files:**
- Create: `scripts/yaml-parser.js`
- Create: `tests/test-yaml-parser.js`

**Step 1: Write the failing test**

```js
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
```

Write to `tests/test-yaml-parser.js`.

**Step 2: Run the test to verify it fails**

Run: `node tests/test-yaml-parser.js`
Expected: FAIL with `Cannot find module` error

**Step 3: Implement the YAML parser**

```js
#!/usr/bin/env node
'use strict';

/**
 * Minimal YAML parser for FSD config files.
 * Handles: flat key-value pairs, string arrays (- item), comments, blank lines.
 * Does NOT handle: nested objects, multi-line strings, anchors, flow sequences.
 */
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentArrayKey = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      // If we hit a blank line or comment, don't reset currentArrayKey
      // (arrays can have comments interspersed)
      continue;
    }

    // Array item: "  - value"
    if (trimmed.startsWith('- ') && currentArrayKey) {
      let value = trimmed.slice(2).trim();
      value = stripQuotes(value);
      result[currentArrayKey].push(value);
      continue;
    }

    // Key-value pair: "key: value" or "key:" (start of array)
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();

    if (rawValue === '' || rawValue === '|' || rawValue === '>') {
      // Start of an array (or block scalar — we only support arrays)
      currentArrayKey = key;
      result[key] = [];
    } else {
      // Simple key-value
      currentArrayKey = null;
      result[key] = stripQuotes(rawValue);
    }
  }

  return result;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

module.exports = { parseYaml };
```

Write to `scripts/yaml-parser.js`.

**Step 4: Run the test to verify it passes**

Run: `node tests/test-yaml-parser.js`
Expected: `All yaml-parser tests passed`

**Step 5: Run the full test suite**

Run: `bash tests/run-tests.sh`
Expected: `Results: 1 passed, 0 failed`

**Step 6: Commit**

```bash
git add scripts/yaml-parser.js tests/test-yaml-parser.js
git commit -m "feat: add minimal YAML parser for FSD config files"
```

---

## Task 3: Config Cascade System

Reads `config.yaml` from up to three layers and performs shallow merge: project > user > core.

**Files:**
- Create: `scripts/config.js`
- Create: `tests/test-config.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require(path.join(__dirname, '..', 'scripts', 'config.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

function writeYaml(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), content);
}

// Test 1: Single layer — reads core config
{
  const coreDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: plan-execute-verify\nskills_dir: "./skills"');

  const config = loadConfig({ corePath: coreDir, userPath: '/nonexistent', projectPath: '/nonexistent' });
  assert.strictEqual(config.workflow, 'plan-execute-verify');
  assert.strictEqual(config.skills_dir, './skills');

  fs.rmSync(coreDir, { recursive: true });
}

// Test 2: User overrides core
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: plan-execute-verify\nskills_dir: "./skills"');
  writeYaml(userDir, 'workflow: my-custom-flow');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  assert.strictEqual(config.workflow, 'my-custom-flow');
  assert.strictEqual(config.skills_dir, './skills'); // inherited from core

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 3: Project overrides both
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  writeYaml(coreDir, 'workflow: core-flow\nskills_dir: "./skills"');
  writeYaml(userDir, 'workflow: user-flow\nagents_dir: "./my-agents"');
  writeYaml(projDir, 'workflow: project-flow');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: projDir });
  assert.strictEqual(config.workflow, 'project-flow');
  assert.strictEqual(config.skills_dir, './skills');
  assert.strictEqual(config.agents_dir, './my-agents');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 4: Missing config files are gracefully skipped
{
  const config = loadConfig({ corePath: '/nonexistent', userPath: '/nonexistent', projectPath: '/nonexistent' });
  assert.deepStrictEqual(config, {});
}

// Test 5: Array values merge by replacement (not concatenation)
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  writeYaml(coreDir, 'disabled:\n  - "skills/brainstorm"\n  - "skills/debug"');
  writeYaml(userDir, 'disabled:\n  - "skills/verify"');

  const config = loadConfig({ corePath: coreDir, userPath: userDir, projectPath: '/nonexistent' });
  // Shallow merge: user's disabled array replaces core's entirely
  assert.deepStrictEqual(config.disabled, ['skills/verify']);

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

console.log('  All config tests passed');
```

Write to `tests/test-config.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-config.js`
Expected: FAIL with `Cannot find module`

**Step 3: Implement the config module**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));

/**
 * Load and merge config.yaml from three layers.
 * Shallow merge: project > user > core (later layers override earlier).
 *
 * @param {Object} paths
 * @param {string} paths.corePath  - Core plugin directory
 * @param {string} paths.userPath  - User space (~/.fsd/)
 * @param {string} paths.projectPath - Project space (.fsd/)
 * @returns {Object} Merged config
 */
function loadConfig({ corePath, userPath, projectPath }) {
  const layers = [corePath, userPath, projectPath];
  let merged = {};

  for (const layerPath of layers) {
    const configFile = path.join(layerPath, 'config.yaml');
    if (!fs.existsSync(configFile)) continue;

    const content = fs.readFileSync(configFile, 'utf-8');
    const parsed = parseYaml(content);

    // Shallow merge: each key from higher layer replaces entirely
    merged = { ...merged, ...parsed };
  }

  return merged;
}

/**
 * Resolve the standard three-layer paths.
 *
 * @param {string} [pluginRoot] - Override for CLAUDE_PLUGIN_ROOT
 * @returns {Object} { corePath, userPath, projectPath }
 */
function resolveLayerPaths(pluginRoot) {
  const corePath = pluginRoot || process.env.CLAUDE_PLUGIN_ROOT || __dirname;
  const userPath = path.join(process.env.HOME || '~', '.fsd');
  const projectPath = path.join(process.cwd(), '.fsd');
  return { corePath, userPath, projectPath };
}

module.exports = { loadConfig, resolveLayerPaths };
```

Write to `scripts/config.js`.

**Step 4: Run test to verify it passes**

Run: `node tests/test-config.js`
Expected: `All config tests passed`

**Step 5: Run full test suite**

Run: `bash tests/run-tests.sh`
Expected: `Results: 2 passed, 0 failed`

**Step 6: Commit**

```bash
git add scripts/config.js tests/test-config.js
git commit -m "feat: add three-layer config cascade system"
```

---

## Task 4: Content Loader / Resolver

Scans skills, agents, and commands from all three layers. Resolves name collisions by priority (project > user > core). Filters out disabled content.

**Files:**
- Create: `scripts/loader.js`
- Create: `tests/test-loader.js`

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

function createSkill(baseDir, name, description) {
  const skillDir = path.join(baseDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nContent here.`);
}

function createAgent(baseDir, name, description) {
  fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\nAgent content.`);
}

// Test 1: Discovers skills from a single layer
{
  const coreDir = mkTmpDir();
  createSkill(coreDir, 'brainstorm', 'Ideation skill');
  createSkill(coreDir, 'plan', 'Planning skill');

  const content = loadContent({
    corePath: coreDir,
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {}
  });

  assert.strictEqual(content.skills.length, 2);
  assert.strictEqual(content.skills.find(s => s.name === 'brainstorm').layer, 'core');
  assert.strictEqual(content.skills.find(s => s.name === 'plan').layer, 'core');

  fs.rmSync(coreDir, { recursive: true });
}

// Test 2: Discovers agents from a single layer
{
  const coreDir = mkTmpDir();
  createAgent(coreDir, 'explorer', 'Codebase analysis');

  const content = loadContent({
    corePath: coreDir,
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {}
  });

  assert.strictEqual(content.agents.length, 1);
  assert.strictEqual(content.agents[0].name, 'explorer');
  assert.strictEqual(content.agents[0].layer, 'core');

  fs.rmSync(coreDir, { recursive: true });
}

// Test 3: User layer shadows core (same name)
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  createSkill(coreDir, 'brainstorm', 'Core brainstorm');
  createSkill(userDir, 'brainstorm', 'My custom brainstorm');

  const content = loadContent({
    corePath: coreDir,
    userPath: userDir,
    projectPath: '/nonexistent',
    config: {}
  });

  assert.strictEqual(content.skills.length, 1);
  assert.strictEqual(content.skills[0].layer, 'user');
  assert.strictEqual(content.skills[0].description, 'My custom brainstorm');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
}

// Test 4: Project layer shadows both user and core
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  createSkill(coreDir, 'brainstorm', 'Core version');
  createSkill(userDir, 'brainstorm', 'User version');
  createSkill(projDir, 'brainstorm', 'Project version');

  const content = loadContent({
    corePath: coreDir,
    userPath: userDir,
    projectPath: projDir,
    config: {}
  });

  assert.strictEqual(content.skills.length, 1);
  assert.strictEqual(content.skills[0].layer, 'project');
  assert.strictEqual(content.skills[0].description, 'Project version');

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 5: Content from different layers with unique names all appear
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();
  createSkill(coreDir, 'brainstorm', 'Core ideation');
  createSkill(coreDir, 'plan', 'Core planning');
  createSkill(userDir, 'tdd', 'My TDD skill');
  createSkill(projDir, 'code-review', 'Team review');

  const content = loadContent({
    corePath: coreDir,
    userPath: userDir,
    projectPath: projDir,
    config: {}
  });

  assert.strictEqual(content.skills.length, 4);
  const names = content.skills.map(s => s.name).sort();
  assert.deepStrictEqual(names, ['brainstorm', 'code-review', 'plan', 'tdd']);

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 6: Disabled content is filtered out
{
  const coreDir = mkTmpDir();
  createSkill(coreDir, 'brainstorm', 'Ideation');
  createSkill(coreDir, 'plan', 'Planning');
  createSkill(coreDir, 'debug', 'Debugging');

  const content = loadContent({
    corePath: coreDir,
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: { disabled: ['skills/brainstorm', 'skills/debug'] }
  });

  assert.strictEqual(content.skills.length, 1);
  assert.strictEqual(content.skills[0].name, 'plan');

  fs.rmSync(coreDir, { recursive: true });
}

// Test 7: Empty directories handled gracefully
{
  const content = loadContent({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {}
  });

  assert.deepStrictEqual(content.skills, []);
  assert.deepStrictEqual(content.agents, []);
}

console.log('  All loader tests passed');
```

Write to `tests/test-loader.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-loader.js`
Expected: FAIL with `Cannot find module`

**Step 3: Implement the content loader**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));

const LAYERS = ['core', 'user', 'project'];

/**
 * Scan a directory for skill subdirectories (each containing SKILL.md).
 * @param {string} baseDir - Layer root directory
 * @param {string} layer - Layer name (core/user/project)
 * @returns {Array} Array of { name, description, layer, path }
 */
function scanSkills(baseDir, layer) {
  const skillsDir = path.join(baseDir, 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, 'utf-8');
    const meta = extractFrontmatter(content);
    skills.push({
      name: meta.name || entry.name,
      description: meta.description || '',
      layer,
      path: skillFile,
    });
  }

  return skills;
}

/**
 * Scan a directory for agent .md files.
 * @param {string} baseDir - Layer root directory
 * @param {string} layer - Layer name
 * @returns {Array} Array of { name, description, layer, path }
 */
function scanAgents(baseDir, layer) {
  const agentsDir = path.join(baseDir, 'agents');
  if (!fs.existsSync(agentsDir)) return [];

  const entries = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  const agents = [];

  for (const file of entries) {
    const filePath = path.join(agentsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const meta = extractFrontmatter(content);
    agents.push({
      name: meta.name || file.replace('.md', ''),
      description: meta.description || '',
      layer,
      path: filePath,
    });
  }

  return agents;
}

/**
 * Extract YAML frontmatter from a markdown file.
 * @param {string} content - File content
 * @returns {Object} Parsed frontmatter
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return parseYaml(match[1]);
}

/**
 * Load all content from three layers, resolve shadowing, filter disabled.
 *
 * @param {Object} opts
 * @param {string} opts.corePath
 * @param {string} opts.userPath
 * @param {string} opts.projectPath
 * @param {Object} opts.config - Merged config (from config.js)
 * @returns {Object} { skills: [...], agents: [...] }
 */
function loadContent({ corePath, userPath, projectPath, config }) {
  const layerPaths = [
    { path: corePath, layer: 'core' },
    { path: userPath, layer: 'user' },
    { path: projectPath, layer: 'project' },
  ];

  const disabled = new Set(config.disabled || []);

  // Collect all items, then resolve by name (later layer wins)
  const skillMap = new Map();
  const agentMap = new Map();

  for (const { path: layerPath, layer } of layerPaths) {
    for (const skill of scanSkills(layerPath, layer)) {
      skillMap.set(skill.name, skill); // later layer overwrites
    }
    for (const agent of scanAgents(layerPath, layer)) {
      agentMap.set(agent.name, agent);
    }
  }

  // Filter disabled
  const skills = [...skillMap.values()].filter(s => !disabled.has(`skills/${s.name}`));
  const agents = [...agentMap.values()].filter(a => !disabled.has(`agents/${a.name}`));

  return { skills, agents };
}

module.exports = { loadContent, scanSkills, scanAgents, extractFrontmatter };
```

Write to `scripts/loader.js`.

**Step 4: Run test to verify it passes**

Run: `node tests/test-loader.js`
Expected: `All loader tests passed`

**Step 5: Run full test suite**

Run: `bash tests/run-tests.sh`
Expected: `Results: 3 passed, 0 failed`

**Step 6: Commit**

```bash
git add scripts/loader.js tests/test-loader.js
git commit -m "feat: add three-layer content loader with name shadowing and disabled filtering"
```

---

## Task 5: SessionStart Hook

Wires up the config and loader to run on every session start, injecting the resolved content map into Claude's context.

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/scripts/session-start.sh`

**Step 1: Create the hook entry point script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# session-start.sh — Called by Claude Code on session start.
# Runs the FSD loader and outputs resolved content as context.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Run the loader script which outputs the context block
node "$PLUGIN_ROOT/scripts/session-start-loader.js" "$PLUGIN_ROOT"
```

Write to `hooks/scripts/session-start.sh` and `chmod +x hooks/scripts/session-start.sh`.

**Step 2: Create the Node.js loader entry point**

This script is what the hook calls. It loads config, runs the loader, and outputs the context block.

```js
#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, '..', 'scripts', 'config.js'));
const { loadContent } = require(path.join(__dirname, 'scripts', 'loader.js'));

// Resolve actual script location to find sibling scripts
const pluginRoot = process.argv[2] || process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');

// Fix require paths to use pluginRoot
const config = require(path.join(pluginRoot, 'scripts', 'config.js'));
const loader = require(path.join(pluginRoot, 'scripts', 'loader.js'));

const paths = config.resolveLayerPaths(pluginRoot);
const mergedConfig = config.loadConfig(paths);
const content = loader.loadContent({ ...paths, config: mergedConfig });

// Build context output
const lines = [];
lines.push('FSD Framework Active');
lines.push('====================');
lines.push('');

if (content.skills.length > 0) {
  lines.push(`SKILLS (${content.skills.length} active)`);
  for (const s of content.skills) {
    const desc = s.description ? s.description.slice(0, 50) : '';
    lines.push(`  ${s.name.padEnd(20)} ${s.layer.padEnd(10)} ${desc}`);
  }
  lines.push('');
}

if (content.agents.length > 0) {
  lines.push(`AGENTS (${content.agents.length} active)`);
  for (const a of content.agents) {
    const desc = a.description ? a.description.slice(0, 50) : '';
    lines.push(`  ${a.name.padEnd(20)} ${a.layer.padEnd(10)} ${desc}`);
  }
  lines.push('');
}

lines.push(`Layers: core (${pluginRoot}) | user (~/.fsd/) | project (.fsd/)`);
lines.push('Commands: /fsd:list, /fsd:add, /fsd:init');

process.stdout.write(lines.join('\n') + '\n');
```

Wait — this script has a bug: it re-requires config/loader with different paths. Let me simplify.

Actually, let me restructure this. The `session-start.sh` hook calls a single Node script that does everything:

```js
#!/usr/bin/env node
'use strict';

const path = require('path');
const pluginRoot = process.argv[2] || process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');

const { loadConfig, resolveLayerPaths } = require(path.join(pluginRoot, 'scripts', 'config.js'));
const { loadContent } = require(path.join(pluginRoot, 'scripts', 'loader.js'));

const paths = resolveLayerPaths(pluginRoot);
const mergedConfig = loadConfig(paths);
const content = loadContent({ ...paths, config: mergedConfig });

const lines = [];
lines.push('FSD Framework Active');
lines.push('====================');
lines.push('');

if (content.skills.length > 0) {
  lines.push(`SKILLS (${content.skills.length} active)`);
  for (const s of content.skills) {
    const desc = (s.description || '').slice(0, 50);
    lines.push(`  ${s.name.padEnd(20)} ${s.layer.padEnd(10)} ${desc}`);
  }
  lines.push('');
}

if (content.agents.length > 0) {
  lines.push(`AGENTS (${content.agents.length} active)`);
  for (const a of content.agents) {
    const desc = (a.description || '').slice(0, 50);
    lines.push(`  ${a.name.padEnd(20)} ${a.layer.padEnd(10)} ${desc}`);
  }
  lines.push('');
}

lines.push(`Layers: core (${pluginRoot}) | user (~/.fsd/) | project (.fsd/)`);
lines.push('Commands: /fsd:list, /fsd:add, /fsd:init');

process.stdout.write(lines.join('\n') + '\n');
```

Write to `scripts/session-start-loader.js`.

**Step 3: Create hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "bash '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh'",
            "async": false
          }
        ]
      }
    ]
  }
}
```

Write to `hooks/hooks.json`.

**Step 4: Test the hook script manually**

Run: `CLAUDE_PLUGIN_ROOT="$(pwd)" bash hooks/scripts/session-start.sh`
Expected: Output starts with `FSD Framework Active` and lists any discovered content (empty lists if no skills/agents created yet)

**Step 5: Commit**

```bash
git add hooks/hooks.json hooks/scripts/session-start.sh scripts/session-start-loader.js
git commit -m "feat: add SessionStart hook for three-layer content resolution"
```

---

## Task 6: Core Skills

Create the five default skills. Each is a skill subdirectory with SKILL.md following Claude Code plugin conventions (YAML frontmatter with `name` + `description`, body in imperative form).

These are starter versions — minimal but functional. Each skill should be ~300-500 words, focused on the core workflow step it represents.

**Files:**
- Create: `skills/brainstorm/SKILL.md`
- Create: `skills/plan/SKILL.md`
- Create: `skills/execute/SKILL.md`
- Create: `skills/verify/SKILL.md`
- Create: `skills/debug/SKILL.md`

**Step 1: Create brainstorm skill**

```markdown
---
name: brainstorm
description: This skill should be used when the user asks to "brainstorm", "explore ideas", "design a feature", "think through options", or begins any creative work like creating features, building components, or modifying behavior. Explores user intent, requirements, and design before implementation.
---

# Brainstorm

## Overview

Explore ideas and requirements before committing to implementation. Brainstorming prevents premature coding by ensuring the problem space is understood and design options are evaluated.

## When to Use

Invoke before any creative or design work — new features, architecture changes, product concepts, or significant modifications to existing behavior.

## Process

### 1. Clarify Intent

Ask focused questions to understand:
- What problem is being solved?
- Who is the audience?
- What does success look like?

Limit to 2-3 questions per round to avoid overwhelming.

### 2. Explore Options

Generate 2-3 distinct approaches. For each:
- Name the approach (e.g., "Event-driven", "Polling-based")
- List key trade-offs (complexity, performance, maintainability)
- Identify unknowns or risks

### 3. Evaluate and Converge

Present options side-by-side. Help the user choose by surfacing:
- Which approach best fits stated constraints
- Which unknowns are most dangerous
- What can be deferred vs. decided now

### 4. Document Decision

Capture the chosen direction in 3-5 sentences covering:
- The approach selected
- Key reasons for the choice
- Any constraints or assumptions

## Output

A clear design direction ready to hand off to the **plan** skill for detailed task breakdown.
```

Write to `skills/brainstorm/SKILL.md`.

**Step 2: Create plan skill**

```markdown
---
name: plan
description: This skill should be used when the user asks to "plan", "create a plan", "break down tasks", "write implementation steps", or needs to turn a design decision into an ordered task list before writing code.
---

# Plan

## Overview

Turn a design direction into an ordered, bite-sized implementation plan. Each task should be completable in 2-10 minutes with clear inputs, outputs, and verification steps.

## When to Use

Invoke after brainstorming (or when the user has a clear idea) and before writing any code.

## Process

### 1. Identify Components

List the distinct pieces of work:
- New files to create
- Existing files to modify
- Tests to write
- Configuration changes

### 2. Order by Dependency

Arrange tasks so each builds on the previous:
- Foundation first (data models, utilities)
- Core logic next
- Integration and wiring last
- Tests alongside each component (TDD preferred)

### 3. Write Tasks

For each task, specify:
- **Files:** Exact paths to create or modify
- **What:** One clear action (not "implement the feature")
- **Verify:** How to confirm it works (test command, expected output)
- **Commit point:** Group related changes into atomic commits

### 4. Review the Plan

Check for:
- Missing dependencies between tasks
- Tasks that are too large (split anything over 10 minutes)
- Missing test coverage
- Unnecessary complexity (YAGNI)

## Output

A numbered task list ready for the **execute** skill.
```

Write to `skills/plan/SKILL.md`.

**Step 3: Create execute skill**

```markdown
---
name: execute
description: This skill should be used when the user asks to "execute", "implement", "build", "start coding", or has an approved plan ready to implement task by task.
---

# Execute

## Overview

Implement a plan task by task with test-driven development and frequent commits. Focus on one task at a time — complete it fully before moving on.

## When to Use

Invoke when a plan exists (from the **plan** skill or user-provided) and it's time to write code.

## Process

### 1. Read the Plan

Load the plan document. Identify the first incomplete task.

### 2. For Each Task

Follow TDD cycle:
1. **Write the failing test** — assert the expected behavior
2. **Run the test** — confirm it fails for the right reason
3. **Write minimal implementation** — just enough to pass
4. **Run the test** — confirm it passes
5. **Refactor if needed** — clean up without changing behavior
6. **Commit** — atomic commit with descriptive message

### 3. Between Tasks

After completing each task:
- Run the full test suite to catch regressions
- Review the plan — does the next task still make sense?
- Note any deviations or discoveries

### 4. Handle Blockers

If a task can't be completed as planned:
- Document what's blocking
- Propose an alternative approach
- Get user confirmation before deviating from the plan

## Output

Working, tested code with clean commit history. Each commit maps to a plan task.
```

Write to `skills/execute/SKILL.md`.

**Step 4: Create verify skill**

```markdown
---
name: verify
description: This skill should be used when the user asks to "verify", "check my work", "review the implementation", or after completing a plan to ensure everything works correctly and meets requirements.
---

# Verify

## Overview

Confirm that completed work meets requirements, passes tests, and is ready for use. Verification catches issues before they reach users.

## When to Use

Invoke after the **execute** skill completes all plan tasks, or when the user wants a quality check on recent work.

## Process

### 1. Run All Tests

Execute the full test suite. All tests must pass. If any fail:
- Identify the root cause
- Fix it before proceeding
- Re-run to confirm

### 2. Check Against Requirements

Compare the implementation to the original requirements or plan:
- Does every planned feature work?
- Are there edge cases not covered?
- Does the code match the agreed design?

### 3. Review Code Quality

Check for:
- Unused imports or dead code
- Missing error handling at system boundaries
- Security concerns (injection, XSS, exposed secrets)
- Performance issues in hot paths

### 4. Manual Smoke Test

If applicable, run the feature manually:
- Happy path works as expected
- Error states show useful messages
- UI renders correctly (if frontend)

## Output

A verification report: what passed, what needs attention, and whether the work is complete.
```

Write to `skills/verify/SKILL.md`.

**Step 5: Create debug skill**

```markdown
---
name: debug
description: This skill should be used when the user asks to "debug", "fix a bug", "investigate an error", "troubleshoot", or encounters unexpected behavior that needs systematic diagnosis.
---

# Debug

## Overview

Systematically diagnose and fix bugs using evidence-based reasoning. Resist the urge to guess — gather data first, form hypotheses, then test them.

## When to Use

Invoke when encountering a bug, test failure, unexpected behavior, or error message that needs investigation.

## Process

### 1. Reproduce

Confirm the bug exists and is reproducible:
- What is the exact error message or unexpected behavior?
- What is the exact command or action that triggers it?
- Does it happen every time or intermittently?

### 2. Gather Evidence

Before forming hypotheses, collect data:
- Read relevant error logs and stack traces
- Check recent changes (git diff, git log)
- Identify the code path involved
- Check inputs and outputs at key points

### 3. Form Hypotheses

Based on evidence, list 2-3 possible causes ranked by likelihood:
1. Most likely cause and why
2. Second most likely
3. Less likely but worth checking

### 4. Test Hypotheses

For each hypothesis (starting with most likely):
- Design a specific test that would confirm or rule it out
- Run the test
- Record the result
- Move to next hypothesis if ruled out

### 5. Fix and Verify

Once the root cause is confirmed:
- Write a test that reproduces the bug
- Implement the minimal fix
- Run the test to confirm the fix
- Run the full test suite to check for regressions

## Output

A working fix with a regression test, plus a brief note on root cause for future reference.
```

Write to `skills/debug/SKILL.md`.

**Step 6: Verify skills are discoverable**

Run: `CLAUDE_PLUGIN_ROOT="$(pwd)" node -e "const l = require('./scripts/loader'); const c = l.loadContent({corePath: '.', userPath: '/x', projectPath: '/x', config: {}}); console.log(c.skills.map(s => s.name))"`
Expected: `['brainstorm', 'plan', 'execute', 'verify', 'debug']` (order may vary)

**Step 7: Commit**

```bash
git add skills/
git commit -m "feat: add five core skills — brainstorm, plan, execute, verify, debug"
```

---

## Task 7: Core Agents

Two starter agents following Claude Code agent .md conventions.

**Files:**
- Create: `agents/explorer.md`
- Create: `agents/reviewer.md`

**Step 1: Create explorer agent**

```markdown
---
name: explorer
description: |
  Use this agent when the user asks to "explore the codebase", "understand the architecture", "find where X is implemented", "map the code", or needs deep analysis of code structure. Examples:
  <example>
  Context: User wants to understand a new codebase
  user: "Help me understand how authentication works in this project"
  assistant: "I'll use the explorer agent to trace the authentication flow"
  <commentary>User needs codebase understanding, trigger explorer for deep analysis.</commentary>
  </example>
  <example>
  Context: User needs to find specific functionality
  user: "Where is the payment processing handled?"
  assistant: "I'll use the explorer agent to locate and map the payment code"
  <commentary>Finding code requires systematic search, trigger explorer.</commentary>
  </example>
model: sonnet
color: cyan
tools: ["Glob", "Grep", "Read", "LS", "WebSearch"]
---

You are a codebase exploration specialist. Your job is to systematically analyze codebases to answer questions about architecture, implementation patterns, and code organization.

## Approach

1. Start broad — understand the project structure (package.json, directory layout, entry points)
2. Follow the dependency chain — trace imports/requires from entry points to the relevant code
3. Read carefully — understand the actual implementation, not just file names
4. Summarize clearly — provide specific file paths, line numbers, and code snippets

## Output Format

Always provide:
- **File paths** with line numbers for key code
- **Data flow** showing how information moves through the system
- **Key abstractions** — classes, interfaces, or patterns used
- **Dependencies** — external libraries and how they're used

Be thorough but concise. Reference specific code, not vague descriptions.
```

Write to `agents/explorer.md`.

**Step 2: Create reviewer agent**

```markdown
---
name: reviewer
description: |
  Use this agent when the user asks to "review code", "check for issues", "review my changes", or when a major implementation step is complete and needs quality review. Examples:
  <example>
  Context: User has finished implementing a feature
  user: "I've finished the user profile page, can you review it?"
  assistant: "I'll use the reviewer agent to check the implementation"
  <commentary>Implementation complete, trigger reviewer for quality check.</commentary>
  </example>
  <example>
  Context: User wants a pre-commit review
  user: "Review my staged changes before I commit"
  assistant: "I'll use the reviewer agent to examine the changes"
  <commentary>Pre-commit review requested, trigger reviewer.</commentary>
  </example>
model: sonnet
color: yellow
tools: ["Glob", "Grep", "Read", "LS", "Bash"]
---

You are a code review specialist focused on catching real issues — bugs, security problems, and logic errors. Skip cosmetic suggestions.

## Review Priorities (ordered by importance)

1. **Correctness** — Does the code do what it claims? Logic errors, off-by-one, null handling.
2. **Security** — Injection, XSS, exposed secrets, improper auth checks.
3. **Error handling** — Are system boundaries protected? Do errors surface useful messages?
4. **Performance** — Only flag issues in hot paths or with data that scales.

## What NOT to Flag

- Style preferences (naming, formatting) unless they cause confusion
- Missing comments on self-explanatory code
- "Could also be done as..." suggestions with no clear benefit
- Theoretical edge cases that can't happen in practice

## Output Format

For each issue found:
- **File:line** — exact location
- **Severity** — bug / security / error-handling / performance
- **Issue** — one sentence describing the problem
- **Fix** — specific code change to resolve it

If no issues found, say so clearly. A clean review is a good outcome.
```

Write to `agents/reviewer.md`.

**Step 3: Verify agents are discoverable**

Run: `CLAUDE_PLUGIN_ROOT="$(pwd)" node -e "const l = require('./scripts/loader'); const c = l.loadContent({corePath: '.', userPath: '/x', projectPath: '/x', config: {}}); console.log(c.agents.map(a => a.name))"`
Expected: `['explorer', 'reviewer']`

**Step 4: Commit**

```bash
git add agents/
git commit -m "feat: add core agents — explorer and reviewer"
```

---

## Task 8: /fsd:init Command

Creates `.fsd/` project space in the current directory.

**Files:**
- Create: `scripts/init.js`
- Create: `tests/test-init.js`
- Create: `commands/init.md`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { initProject } = require(path.join(__dirname, '..', 'scripts', 'init.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

// Test 1: Creates .fsd/ directory structure
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir);

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'config.yaml')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'agents')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'commands')), true);

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 2: Config template has expected content
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);

  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.ok(config.includes('workflow:'));
  assert.ok(config.includes('disabled:'));

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 3: Does not overwrite existing .fsd/
{
  const tmpDir = mkTmpDir();
  fs.mkdirSync(path.join(tmpDir, '.fsd'));
  fs.writeFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'workflow: custom');

  const result = initProject(tmpDir);
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('already exists'));

  // Original content preserved
  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.strictEqual(config, 'workflow: custom');

  fs.rmSync(tmpDir, { recursive: true });
}

console.log('  All init tests passed');
```

Write to `tests/test-init.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-init.js`
Expected: FAIL with `Cannot find module`

**Step 3: Implement init.js**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_TEMPLATE = `# FSD Project Configuration
# This file is committed to git and shared with the team.
# Priority: project (.fsd/) > user (~/.fsd/) > core (plugin)

# Workflow steps (default: plan -> execute -> verify)
workflow: plan-execute-verify

# Disable specific core content
disabled:
  # - "skills/brainstorm"

# Require specific skills (always loaded at session start)
required:
  # - "skills/code-review"

# Team conventions
conventions:
  # commit_style: conventional
  # test_before_complete: true
`;

/**
 * Initialize .fsd/ project space in the given directory.
 * @param {string} projectDir - Directory to initialize
 * @returns {Object} { success: boolean, message: string }
 */
function initProject(projectDir) {
  const fsdDir = path.join(projectDir, '.fsd');

  if (fs.existsSync(fsdDir)) {
    return { success: false, message: `.fsd/ already exists in ${projectDir}` };
  }

  fs.mkdirSync(fsdDir, { recursive: true });
  fs.mkdirSync(path.join(fsdDir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(fsdDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(fsdDir, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(fsdDir, 'config.yaml'), CONFIG_TEMPLATE);

  return { success: true, message: `Initialized .fsd/ in ${projectDir}` };
}

// CLI entry point
if (require.main === module) {
  const targetDir = process.argv[2] || process.cwd();
  const result = initProject(targetDir);
  console.log(result.message);
  process.exit(result.success ? 0 : 1);
}

module.exports = { initProject };
```

Write to `scripts/init.js`.

**Step 4: Run test to verify it passes**

Run: `node tests/test-init.js`
Expected: `All init tests passed`

**Step 5: Create the command .md**

```markdown
---
name: fsd:init
description: Initialize .fsd/ project space in the current directory
---

Initialize an FSD project space in the current directory by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js"
```

Report the result to the user. If initialization succeeds, explain:
- `.fsd/config.yaml` — project config (edit to customize workflow, disable/require content)
- `.fsd/skills/` — project-specific skills (highest priority, committed to git)
- `.fsd/agents/` — project-specific agents
- `.fsd/commands/` — project-specific commands

If `.fsd/` already exists, tell the user and suggest `/fsd:config` to view or edit the existing configuration.
```

Write to `commands/init.md`.

**Step 6: Run full test suite**

Run: `bash tests/run-tests.sh`
Expected: `Results: 4 passed, 0 failed`

**Step 7: Commit**

```bash
git add scripts/init.js tests/test-init.js commands/init.md
git commit -m "feat: add /fsd:init command to create project space"
```

---

## Task 9: /fsd:list Command

Displays all resolved content across layers in a formatted table.

**Files:**
- Create: `scripts/list.js`
- Create: `tests/test-list.js`
- Create: `commands/list.md`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatList } = require(path.join(__dirname, '..', 'scripts', 'list.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

function createSkill(baseDir, name, description) {
  const skillDir = path.join(baseDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nContent.`);
}

function createAgent(baseDir, name, description) {
  fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\nContent.`);
}

// Test 1: Formats skills and agents from multiple layers
{
  const coreDir = mkTmpDir();
  const userDir = mkTmpDir();
  const projDir = mkTmpDir();

  createSkill(coreDir, 'brainstorm', 'Core ideation');
  createSkill(coreDir, 'plan', 'Core planning');
  createSkill(userDir, 'tdd', 'My TDD workflow');
  createSkill(projDir, 'code-review', 'Team review process');
  createAgent(coreDir, 'explorer', 'Codebase analysis');

  const output = formatList({
    corePath: coreDir,
    userPath: userDir,
    projectPath: projDir,
    config: {}
  });

  // Check output contains expected content
  assert.ok(output.includes('SKILLS'));
  assert.ok(output.includes('brainstorm'));
  assert.ok(output.includes('core'));
  assert.ok(output.includes('tdd'));
  assert.ok(output.includes('user'));
  assert.ok(output.includes('code-review'));
  assert.ok(output.includes('project'));
  assert.ok(output.includes('AGENTS'));
  assert.ok(output.includes('explorer'));

  fs.rmSync(coreDir, { recursive: true });
  fs.rmSync(userDir, { recursive: true });
  fs.rmSync(projDir, { recursive: true });
}

// Test 2: Empty content shows helpful message
{
  const output = formatList({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath: '/nonexistent',
    config: {}
  });

  assert.ok(output.includes('No content'));

}

console.log('  All list tests passed');
```

Write to `tests/test-list.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-list.js`
Expected: FAIL with `Cannot find module`

**Step 3: Implement list.js**

```js
#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadContent } = require(path.join(__dirname, 'loader.js'));
const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, 'config.js'));

/**
 * Format the resolved content list for display.
 * @param {Object} opts - { corePath, userPath, projectPath, config }
 * @returns {string} Formatted output
 */
function formatList({ corePath, userPath, projectPath, config }) {
  const content = loadContent({ corePath, userPath, projectPath, config });
  const lines = [];

  if (content.skills.length === 0 && content.agents.length === 0) {
    lines.push('No content found across any layer.');
    lines.push('');
    lines.push('Get started:');
    lines.push('  /fsd:init     Create project space (.fsd/)');
    lines.push('  /fsd:add      Create a skill, agent, or command');
    return lines.join('\n');
  }

  if (content.skills.length > 0) {
    lines.push(`SKILLS (${content.skills.length} active)`);
    for (const s of content.skills) {
      const desc = (s.description || '').slice(0, 45);
      lines.push(`  ${s.name.padEnd(22)} ${s.layer.padEnd(10)} ${desc}`);
    }
    lines.push('');
  }

  if (content.agents.length > 0) {
    lines.push(`AGENTS (${content.agents.length} active)`);
    for (const a of content.agents) {
      const desc = (a.description || '').slice(0, 45);
      lines.push(`  ${a.name.padEnd(22)} ${a.layer.padEnd(10)} ${desc}`);
    }
    lines.push('');
  }

  lines.push('Layer: core | user | import | project');

  return lines.join('\n');
}

// CLI entry point
if (require.main === module) {
  const pluginRoot = process.argv[2] || process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  const paths = resolveLayerPaths(pluginRoot);
  const config = loadConfig(paths);
  console.log(formatList({ ...paths, config }));
}

module.exports = { formatList };
```

Write to `scripts/list.js`.

**Step 4: Run test to verify it passes**

Run: `node tests/test-list.js`
Expected: `All list tests passed`

**Step 5: Create the command .md**

```markdown
---
name: fsd:list
description: Show all active skills, agents, and commands across layers
---

List all active FSD content by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list.js" "${CLAUDE_PLUGIN_ROOT}"
```

Display the output to the user. The list shows content resolved across three layers:
- **core** — built-in content from the FSD plugin
- **user** — personal customizations from ~/.fsd/
- **import** — third-party content installed via /fsd:import
- **project** — team content from .fsd/ in the current project

Higher layers shadow lower layers by name (project > user > core).
```

Write to `commands/list.md`.

**Step 6: Run full test suite**

Run: `bash tests/run-tests.sh`
Expected: `Results: 5 passed, 0 failed`

**Step 7: Commit**

```bash
git add scripts/list.js tests/test-list.js commands/list.md
git commit -m "feat: add /fsd:list command to display resolved content"
```

---

## Task 10: /fsd:add Command

Creates new skills, agents, or commands in user or project space.

**Files:**
- Create: `scripts/add.js`
- Create: `tests/test-add.js`
- Create: `commands/add.md`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { addContent } = require(path.join(__dirname, '..', 'scripts', 'add.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

// Test 1: Creates a skill in user space
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'skill', name: 'my-review', userPath: userDir, project: false });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(userDir, 'skills', 'my-review', 'SKILL.md')), true);

  const content = fs.readFileSync(path.join(userDir, 'skills', 'my-review', 'SKILL.md'), 'utf-8');
  assert.ok(content.includes('name: my-review'));
  assert.ok(content.includes('description:'));

  fs.rmSync(userDir, { recursive: true });
}

// Test 2: Creates a skill in project space with --project
{
  const projDir = mkTmpDir();
  fs.mkdirSync(path.join(projDir, '.fsd'), { recursive: true });

  const result = addContent({ type: 'skill', name: 'team-lint', projectPath: path.join(projDir, '.fsd'), project: true });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(projDir, '.fsd', 'skills', 'team-lint', 'SKILL.md')), true);

  fs.rmSync(projDir, { recursive: true });
}

// Test 3: Creates an agent in user space
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'agent', name: 'my-linter', userPath: userDir, project: false });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(userDir, 'agents', 'my-linter.md')), true);

  const content = fs.readFileSync(path.join(userDir, 'agents', 'my-linter.md'), 'utf-8');
  assert.ok(content.includes('name: my-linter'));

  fs.rmSync(userDir, { recursive: true });
}

// Test 4: Creates a command in user space
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'command', name: 'deploy', userPath: userDir, project: false });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(userDir, 'commands', 'deploy.md')), true);

  fs.rmSync(userDir, { recursive: true });
}

// Test 5: Rejects invalid type
{
  const userDir = mkTmpDir();
  const result = addContent({ type: 'widget', name: 'foo', userPath: userDir, project: false });

  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('Invalid type'));

  fs.rmSync(userDir, { recursive: true });
}

// Test 6: Does not overwrite existing content
{
  const userDir = mkTmpDir();
  addContent({ type: 'skill', name: 'existing', userPath: userDir, project: false });

  // Write custom content
  const skillPath = path.join(userDir, 'skills', 'existing', 'SKILL.md');
  fs.writeFileSync(skillPath, 'custom content');

  const result = addContent({ type: 'skill', name: 'existing', userPath: userDir, project: false });
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('already exists'));

  // Original preserved
  assert.strictEqual(fs.readFileSync(skillPath, 'utf-8'), 'custom content');

  fs.rmSync(userDir, { recursive: true });
}

console.log('  All add tests passed');
```

Write to `tests/test-add.js`.

**Step 2: Run test to verify it fails**

Run: `node tests/test-add.js`
Expected: FAIL with `Cannot find module`

**Step 3: Implement add.js**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES = {
  skill: (name) => `---
name: ${name}
description: This skill should be used when the user asks to "${name}", or needs guidance on ${name}-related tasks.
---

# ${name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')}

## Overview

Describe what this skill does and when to use it.

## Process

### 1. First Step

Instructions here.

### 2. Second Step

Instructions here.

## Output

Describe the expected output.
`,

  agent: (name) => `---
name: ${name}
description: |
  Use this agent when the user asks to "${name}" or needs ${name}-related assistance. Examples:
  <example>
  Context: User needs ${name} help
  user: "Help me with ${name}"
  assistant: "I'll use the ${name} agent to assist"
  <commentary>User needs ${name} assistance, trigger this agent.</commentary>
  </example>
model: sonnet
color: cyan
---

You are a ${name.replace(/-/g, ' ')} specialist.

## Approach

1. Understand the request
2. Analyze the context
3. Provide targeted assistance

## Output Format

Provide clear, actionable results with specific file paths and code references.
`,

  command: (name) => `---
name: fsd:${name}
description: ${name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')}
---

Implement the ${name} command.

Describe what this command should do when invoked.
`,
};

const VALID_TYPES = ['skill', 'agent', 'command'];

/**
 * Create new content in user or project space.
 * @param {Object} opts
 * @param {string} opts.type - skill | agent | command
 * @param {string} opts.name - Content name (kebab-case)
 * @param {string} [opts.userPath] - User space path (~/.fsd/)
 * @param {string} [opts.projectPath] - Project space path (.fsd/)
 * @param {boolean} opts.project - If true, create in project space
 * @returns {Object} { success: boolean, message: string, path: string }
 */
function addContent({ type, name, userPath, projectPath, project }) {
  if (!VALID_TYPES.includes(type)) {
    return { success: false, message: `Invalid type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}` };
  }

  const baseDir = project ? projectPath : userPath;
  let targetPath;

  if (type === 'skill') {
    targetPath = path.join(baseDir, 'skills', name, 'SKILL.md');
  } else if (type === 'agent') {
    targetPath = path.join(baseDir, 'agents', `${name}.md`);
  } else {
    targetPath = path.join(baseDir, 'commands', `${name}.md`);
  }

  if (fs.existsSync(targetPath)) {
    return { success: false, message: `${type} "${name}" already exists at ${targetPath}` };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, TEMPLATES[type](name));

  const layer = project ? 'project' : 'user';
  return { success: true, message: `Created ${type} "${name}" in ${layer} space: ${targetPath}`, path: targetPath };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const type = args[0];
  const name = args[1];
  const isProject = args.includes('--project');

  if (!type || !name) {
    console.error('Usage: add.js <skill|agent|command> <name> [--project]');
    process.exit(1);
  }

  const userPath = path.join(process.env.HOME || '~', '.fsd');
  const projectPath = path.join(process.cwd(), '.fsd');

  const result = addContent({ type, name, userPath, projectPath, project: isProject });
  console.log(result.message);
  process.exit(result.success ? 0 : 1);
}

module.exports = { addContent };
```

Write to `scripts/add.js`.

**Step 4: Run test to verify it passes**

Run: `node tests/test-add.js`
Expected: `All add tests passed`

**Step 5: Create the command .md**

```markdown
---
name: fsd:add
description: Create a new skill, agent, or command
argument-hint: "<skill|agent|command> <name> [--project]"
---

Create new FSD content. Parse the user's arguments to determine:
- **type**: skill, agent, or command
- **name**: kebab-case name for the content
- **--project**: if specified, create in .fsd/ (project space) instead of ~/.fsd/ (user space)

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/add.js" $ARGUMENTS
```

Report the result. If successful, suggest the user edit the generated file to customize it. Mention:
- Skills: edit the SKILL.md description triggers and body content
- Agents: edit the description examples and system prompt
- Commands: edit the command instructions
```

Write to `commands/add.md`.

**Step 6: Run full test suite**

Run: `bash tests/run-tests.sh`
Expected: `Results: 6 passed, 0 failed`

**Step 7: Commit**

```bash
git add scripts/add.js tests/test-add.js commands/add.md
git commit -m "feat: add /fsd:add command to create skills, agents, and commands"
```

---

## Phase 2: Future Tasks (Not in this plan)

These are documented for the next planning cycle. Do not implement them now.

| Task | Description | Depends On |
|------|-------------|------------|
| `/fsd:import` | Git import system — clone repos, parse fsd-manifest.yaml, symlink content, manage imports.lock | loader, config |
| `/fsd:config` | View/edit config at any layer | config |
| `/fsd:upgrade` | Core plugin update with compatibility check and changelog | loader |
| `/fsd:diff` | Compare override with core version side-by-side | loader |
| `/fsd:export` | Package user content with fsd-manifest.yaml for sharing | loader |
| Import conflict resolution | Handle name collisions during import with `--override` flag | /fsd:import |
| Workflow engine | Enforce workflow step ordering (plan -> execute -> verify) | config, skills |
| `required` skills loader | Auto-load required skills at session start via hook | config, hook |
| User space init | Auto-create `~/.fsd/` on first use if missing | init |

---

## Summary

**10 tasks in this plan.** Build order:

```
Task 1: Plugin scaffold + test harness
Task 2: YAML parser utility
Task 3: Config cascade system
Task 4: Content loader / resolver
Task 5: SessionStart hook
Task 6: Core skills (5)
Task 7: Core agents (2)
Task 8: /fsd:init command
Task 9: /fsd:list command
Task 10: /fsd:add command
```

Each task follows TDD: write failing test → implement → verify pass → commit.

After Task 10, the MVP is complete: a working Claude Code plugin with three-layer resolution, five skills, two agents, and three commands.
