#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getStructure, DEFAULT_STRUCTURE } = require(path.join(__dirname, "config.js"));
const { SCANNABLE_KINDS, STORAGE_KINDS } = require(path.join(__dirname, "validator.js"));

const CONFIG_TEMPLATE = `# FSD Project Configuration
# This file is committed to git and shared with the team.
# Priority: project (.fsd/) > user (~/.fsd/) > core (plugin)

# Workflow steps (default: spec -> plan -> execute -> verify)
workflow: spec-plan-execute-verify

# Content-kind → directory mapping (partial override; unset keys use defaults)
# Use /fsd-restructure to rename safely after install.
structure:
  # Scannable kinds (loaded and activated by the framework):
  # skills: skills
  # agents: agents
  # commands: commands
  # Storage kinds (artifacts written by /fsd-spec, /fsd-plan, /fsd-research):
  # spec: spec
  # plan: plan
  # research: research

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
 * Scaffolds both scannable kinds (skills/agents/commands) and storage kinds
 * (spec/plan/research). Storage dirs get a .gitkeep so git tracks them empty.
 *
 * @param {string} projectDir - Directory to initialize
 * @param {Object} [config] - Optional config to drive structure (defaults to DEFAULT_STRUCTURE)
 * @returns {Object} { success: boolean, message: string }
 */
function initProject(projectDir, config) {
  const fsdDir = path.join(projectDir, ".fsd");

  if (fs.existsSync(fsdDir)) {
    return { success: false, message: `.fsd/ already exists in ${projectDir}` };
  }

  const structure = getStructure(config || {});
  fs.mkdirSync(fsdDir, { recursive: true });
  for (const kind of Object.keys(structure)) {
    const dir = path.join(fsdDir, structure[kind]);
    fs.mkdirSync(dir, { recursive: true });
    if (STORAGE_KINDS.includes(kind)) {
      fs.writeFileSync(path.join(dir, ".gitkeep"), "");
    }
  }
  fs.writeFileSync(path.join(fsdDir, "config.yaml"), CONFIG_TEMPLATE);

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
