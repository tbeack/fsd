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
