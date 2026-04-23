#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadContent } = require(path.join(__dirname, 'loader.js'));
const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, 'config.js'));

/**
 * Format validation status for display.
 */
function formatStatus(validation) {
  if (!validation) return 'ok';
  if (validation.errors.length > 0) return `${validation.errors.length} err`;
  if (validation.warnings.length > 0) return `${validation.warnings.length} warn`;
  return 'ok';
}

/**
 * Format layer name with optional override indicator.
 */
function formatLayer(item) {
  return item.overrides ? `${item.layer} [>]` : item.layer;
}

/**
 * Format the resolved content list for display.
 * @param {Object} opts - { corePath, userPath, projectPath, config }
 * @returns {string} Formatted output
 */
function formatList({ corePath, userPath, projectPath, config }) {
  const content = loadContent({ corePath, userPath, projectPath, config });
  const lines = [];

  const noContent = content.skills.length === 0
    && content.agents.length === 0
    && content.commands.length === 0;

  if (noContent) {
    lines.push('No content found across any layer.');
    lines.push('');
    lines.push('Get started:');
    lines.push('  /fsd:init     Create project space (.fsd/)');
    lines.push('  /fsd:add      Create a skill, agent, or command');
    return lines.join('\n');
  }

  if (content.skills.length > 0) {
    const errCount = content.skills.filter(s => !s.validation.valid).length;
    const header = errCount > 0
      ? `SKILLS (${content.skills.length} active, ${errCount} invalid)`
      : `SKILLS (${content.skills.length} active)`;
    lines.push(header);
    lines.push(`  ${'NAME'.padEnd(22)} ${'LAYER'.padEnd(12)} ${'STATUS'.padEnd(8)} DESCRIPTION`);
    for (const s of content.skills) {
      const desc = (s.description || '').slice(0, 40);
      const layer = formatLayer(s).padEnd(12);
      const status = formatStatus(s.validation).padEnd(8);
      lines.push(`  ${s.name.padEnd(22)} ${layer} ${status} ${desc}`);
    }
    lines.push('');
  }

  if (content.agents.length > 0) {
    const errCount = content.agents.filter(a => !a.validation.valid).length;
    const header = errCount > 0
      ? `AGENTS (${content.agents.length} active, ${errCount} invalid)`
      : `AGENTS (${content.agents.length} active)`;
    lines.push(header);
    lines.push(`  ${'NAME'.padEnd(22)} ${'LAYER'.padEnd(12)} ${'STATUS'.padEnd(8)} DESCRIPTION`);
    for (const a of content.agents) {
      const desc = (a.description || '').slice(0, 40);
      const layer = formatLayer(a).padEnd(12);
      const status = formatStatus(a.validation).padEnd(8);
      lines.push(`  ${a.name.padEnd(22)} ${layer} ${status} ${desc}`);
    }
    lines.push('');
  }

  if (content.commands.length > 0) {
    const errCount = content.commands.filter(c => !c.validation.valid).length;
    const header = errCount > 0
      ? `COMMANDS (${content.commands.length} active, ${errCount} invalid)`
      : `COMMANDS (${content.commands.length} active)`;
    lines.push(header);
    lines.push(`  ${'NAME'.padEnd(22)} ${'LAYER'.padEnd(12)} ${'STATUS'.padEnd(8)} DESCRIPTION`);
    for (const c of content.commands) {
      const desc = (c.description || '').slice(0, 40);
      const layer = formatLayer(c).padEnd(12);
      const status = formatStatus(c.validation).padEnd(8);
      lines.push(`  ${c.name.padEnd(22)} ${layer} ${status} ${desc}`);
    }
    lines.push('');
  }

  lines.push('[>] = overrides a lower layer');
  lines.push('Commands: /fsd:list, /fsd:add, /fsd:init, /fsd:validate');

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
