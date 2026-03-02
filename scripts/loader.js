#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));

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
 * Reads baseDir/skills/{skillName}/SKILL.md, extracts frontmatter.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @returns {Array<{name: string, description: string, layer: string, path: string}>}
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

    skills.push({
      name: fm.name || entry.name,
      description: fm.description || '',
      layer,
      path: skillFile,
    });
  }

  return skills;
}

/**
 * Scan a layer's agents directory for .md files.
 * Reads baseDir/agents/{name}.md, extracts frontmatter.
 *
 * @param {string} baseDir - Layer base directory
 * @param {string} layer - Layer name ('core', 'user', 'project')
 * @returns {Array<{name: string, description: string, layer: string, path: string}>}
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

    agents.push({
      name: fm.name || path.basename(entry.name, '.md'),
      description: fm.description || '',
      layer,
      path: agentFile,
    });
  }

  return agents;
}

/**
 * Load and merge content from three layers with name-based shadowing.
 * Scans core -> user -> project; later layers overwrite earlier by name.
 * Filters out items matching config.disabled entries.
 *
 * @param {Object} opts
 * @param {string} opts.corePath - Core plugin directory
 * @param {string} opts.userPath - User space (~/.fsd/)
 * @param {string} opts.projectPath - Project space (.fsd/)
 * @param {Object} opts.config - Merged config (may contain .disabled array)
 * @returns {{ skills: Array, agents: Array }}
 */
function loadContent({ corePath, userPath, projectPath, config }) {
  const layers = [
    { dir: corePath, name: 'core' },
    { dir: userPath, name: 'user' },
    { dir: projectPath, name: 'project' },
  ];

  const skillMap = new Map();
  const agentMap = new Map();

  for (const layer of layers) {
    const skills = scanSkills(layer.dir, layer.name);
    for (const skill of skills) {
      skillMap.set(skill.name, skill);
    }

    const agents = scanAgents(layer.dir, layer.name);
    for (const agent of agents) {
      agentMap.set(agent.name, agent);
    }
  }

  const disabled = new Set(config.disabled || []);

  const skills = [...skillMap.values()].filter(s => !disabled.has(`skills/${s.name}`));
  const agents = [...agentMap.values()].filter(a => !disabled.has(`agents/${a.name}`));

  return { skills, agents };
}

module.exports = { loadContent, scanSkills, scanAgents, extractFrontmatter };
