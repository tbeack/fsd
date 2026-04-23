#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const {
  validateSkill,
  validateAgent,
  validateCommand,
  ARTIFACT_VALIDATORS,
  STORAGE_KINDS,
} = require(path.join(__dirname, 'validator.js'));
const { getStructure } = require(path.join(__dirname, 'config.js'));

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
 * Reads baseDir/<dirName>/{skillName}/SKILL.md, extracts frontmatter, validates.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @param {string} [dirName='skills'] - Subdirectory name from config.structure.skills
 * @returns {Array<{name: string, description: string, layer: string, path: string, validation: Object}>}
 */
function scanSkills(baseDir, layer, dirName = 'skills') {
  const skillsDir = path.join(baseDir, dirName);
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
 * Reads baseDir/<dirName>/{name}.md, extracts frontmatter, validates.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @param {string} [dirName='agents'] - Subdirectory name from config.structure.agents
 * @returns {Array<{name: string, description: string, layer: string, path: string, validation: Object}>}
 */
function scanAgents(baseDir, layer, dirName = 'agents') {
  const agentsDir = path.join(baseDir, dirName);
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
 * Reads baseDir/<dirName>/{name}.md, extracts frontmatter, validates.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @param {string} [dirName='commands'] - Subdirectory name from config.structure.commands
 * @returns {Array}
 */
function scanCommands(baseDir, layer, dirName = 'commands') {
  const commandsDir = path.join(baseDir, dirName);
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
 * Scan a storage-kind artifact directory for `.md` files and validate each.
 * On-demand: NOT used by loadContent. Storage kinds are passive data — they
 * are not loaded into session context, only inspected when explicitly requested
 * (e.g., by `/fsd:validate --artifacts`).
 *
 * Reads `fsdDir/dirName/*.md`, skipping `.gitkeep` and any non-`.md` files.
 * For each file: extracts frontmatter, runs the kind-specific validator, and
 * checks that the filename stem matches `meta.id` (mismatch is a hard error
 * appended to the validation result).
 *
 * @param {Object} opts
 * @param {string} opts.fsdDir   - Project `.fsd/` directory
 * @param {string} opts.kind     - One of STORAGE_KINDS ('spec'|'plan'|'research')
 * @param {string} opts.dirName  - Resolved directory name from config.structure[kind]
 * @returns {Array<{ id: string, title: string, status: string, kind: string, path: string, validation: Object }>}
 */
function scanArtifacts({ fsdDir, kind, dirName }) {
  const validator = ARTIFACT_VALIDATORS[kind];
  if (!validator) {
    throw new Error(`scanArtifacts: unknown storage kind "${kind}" (expected one of ${STORAGE_KINDS.join(', ')})`);
  }

  const dir = path.join(fsdDir, dirName);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const artifacts = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;

    const filePath = path.join(dir, entry.name);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = extractFrontmatter(content);
    const validation = validator(fm);

    const stem = path.basename(entry.name, '.md');
    if (fm.id && fm.id !== stem) {
      validation.errors.push(`id: "${fm.id}" does not match filename stem "${stem}"`);
      validation.valid = false;
    }

    artifacts.push({
      id: fm.id || stem,
      title: fm.title || '',
      status: fm.status || '',
      kind,
      path: filePath,
      validation,
    });
  }

  return artifacts;
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

  const structure = getStructure(config);
  const skillMap = new Map();
  const agentMap = new Map();
  const commandMap = new Map();

  for (const layer of layers) {
    for (const skill of scanSkills(layer.dir, layer.name, structure.skills)) {
      skill.overrides = skillMap.has(skill.name);
      skillMap.set(skill.name, skill);
    }

    for (const agent of scanAgents(layer.dir, layer.name, structure.agents)) {
      agent.overrides = agentMap.has(agent.name);
      agentMap.set(agent.name, agent);
    }

    for (const cmd of scanCommands(layer.dir, layer.name, structure.commands)) {
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

module.exports = { loadContent, scanSkills, scanAgents, scanCommands, scanArtifacts, extractFrontmatter };
