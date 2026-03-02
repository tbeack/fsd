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

  lines.push('Layer: core | user | project');

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
