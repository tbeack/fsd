#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validateSkill, validateAgent, validateCommand } = require(path.join(__dirname, 'validator.js'));

/**
 * Extract YAML frontmatter from a markdown file's content.
 * Matches the --- delimited block at the start of the file.
 *
 * @param {string} content - Raw file content
 * @returns {Object} Parsed frontmatter key-value pairs
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return parseYaml(match[1]);
}

/**
 * Scan a layer's skills directory for SKILL.md files.
 * Reads baseDir/skills/{skillName}/SKILL.md, extracts frontmatter, validates.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @returns {Array<{name: string, description: string, layer: string, path: string, validation: Object}>}
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
    const fm = extractFrontmatter(content);
    const validation = validateSkill(fm);

    skills.push({
      name: fm.name || entry.name,
      description: fm.description || '',
      layer,
      path: skillFile,
      validation,
    });
  }

  return skills;
}

/**
 * Scan a layer's agents directory for .md files.
 * Reads baseDir/agents/{name}.md, extracts frontmatter, validates.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @returns {Array<{name: string, description: string, layer: string, path: string, validation: Object}>}
 */
function scanAgents(baseDir, layer) {
  const agentsDir = path.join(baseDir, 'agents');
  if (!fs.existsSync(agentsDir)) return [];

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  const agents = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const agentFile = path.join(agentsDir, entry.name);
    const content = fs.readFileSync(agentFile, 'utf-8');
    const fm = extractFrontmatter(content);
    const validation = validateAgent(fm);

    agents.push({
      name: fm.name || path.basename(entry.name, '.md'),
      description: fm.description || '',
      layer,
      path: agentFile,
      validation,
    });
  }

  return agents;
}

/**
 * Scan a layer's commands directory for .md files.
 * Reads baseDir/commands/{name}.md, extracts frontmatter, validates.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @returns {Array}
 */
function scanCommands(baseDir, layer) {
  const commandsDir = path.join(baseDir, 'commands');
  if (!fs.existsSync(commandsDir)) return [];

  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
  const commands = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const cmdFile = path.join(commandsDir, entry.name);
    const content = fs.readFileSync(cmdFile, 'utf-8');
    const fm = extractFrontmatter(content);
    const validation = validateCommand(fm);

    commands.push({
      name: fm.name || path.basename(entry.name, '.md'),
      description: fm.description || '',
      layer,
      path: cmdFile,
      validation,
    });
  }

  return commands;
}

/**
 * Load and merge content from three layers with name-based shadowing.
 * Scans core -> user -> project; later layers overwrite earlier by name.
 * Filters out items matching config.disabled entries.
 * Attaches validation results and override indicators to each item.
 *
 * @param {Object} opts
 * @param {string} opts.corePath - Core plugin directory
 * @param {string} opts.userPath - User space (~/.fsd/)
 * @param {string} opts.projectPath - Project space (.fsd/)
 * @param {Object} opts.config - Merged config (may contain .disabled array)
 * @returns {{ skills: Array, agents: Array, commands: Array, validationSummary: Object }}
 */
function loadContent({ corePath, userPath, projectPath, config }) {
  const layers = [
    { dir: corePath, name: 'core' },
    { dir: userPath, name: 'user' },
    { dir: projectPath, name: 'project' },
  ];

  const skillMap = new Map();
  const agentMap = new Map();
  const commandMap = new Map();

  for (const layer of layers) {
    for (const skill of scanSkills(layer.dir, layer.name)) {
      skill.overrides = skillMap.has(skill.name);
      skillMap.set(skill.name, skill);
    }

    for (const agent of scanAgents(layer.dir, layer.name)) {
      agent.overrides = agentMap.has(agent.name);
      agentMap.set(agent.name, agent);
    }

    for (const cmd of scanCommands(layer.dir, layer.name)) {
      cmd.overrides = commandMap.has(cmd.name);
      commandMap.set(cmd.name, cmd);
    }
  }

  const disabled = new Set(config.disabled || []);

  const skills = [...skillMap.values()].filter(s => !disabled.has(`skills/${s.name}`));
  const agents = [...agentMap.values()].filter(a => !disabled.has(`agents/${a.name}`));
  const commands = [...commandMap.values()].filter(c => !disabled.has(`commands/${c.name}`));

  const all = [...skills, ...agents, ...commands];
  const validationSummary = {
    total: all.length,
    valid: all.filter(i => i.validation.valid).length,
    invalid: all.filter(i => !i.validation.valid).length,
    warnings: all.reduce((sum, i) => sum + i.validation.warnings.length, 0),
  };

  return { skills, agents, commands, validationSummary };
}

module.exports = { loadContent, scanSkills, scanAgents, scanCommands, extractFrontmatter };
