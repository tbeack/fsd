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
