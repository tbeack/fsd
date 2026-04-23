#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadContent } = require(path.join(__dirname, 'loader.js'));
const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, 'config.js'));

function formatValidationLine(item) {
  const issues = [...item.validation.errors, ...item.validation.warnings];
  const issueStr = issues.length > 0 ? '   ' + issues.join('; ') : '';

  if (item.validation.errors.length > 0) {
    return `  ERR   ${item.name.padEnd(22)} ${item.layer.padEnd(10)}${issueStr}`;
  }
  if (item.validation.warnings.length > 0) {
    return `  WARN  ${item.name.padEnd(22)} ${item.layer.padEnd(10)}${issueStr}`;
  }
  return `  ok    ${item.name.padEnd(22)} ${item.layer}`;
}

function run() {
  const pluginRoot = process.argv[2] || process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  const filter = process.argv[3] || '';

  const paths = resolveLayerPaths(pluginRoot);
  const config = loadConfig(paths);
  const content = loadContent({ ...paths, config });

  const lines = [];
  lines.push('FSD Validation Report');
  lines.push('=====================');
  lines.push('');

  const showSkills = !filter || filter === '--skills';
  const showAgents = !filter || filter === '--agents';
  const showCommands = !filter || filter === '--commands';

  if (showSkills && content.skills.length > 0) {
    lines.push(`SKILLS (${content.skills.length} checked)`);
    for (const s of content.skills) {
      lines.push(formatValidationLine(s));
    }
    lines.push('');
  }

  if (showAgents && content.agents.length > 0) {
    lines.push(`AGENTS (${content.agents.length} checked)`);
    for (const a of content.agents) {
      lines.push(formatValidationLine(a));
    }
    lines.push('');
  }

  if (showCommands && content.commands.length > 0) {
    lines.push(`COMMANDS (${content.commands.length} checked)`);
    for (const c of content.commands) {
      lines.push(formatValidationLine(c));
    }
    lines.push('');
  }

  const { validationSummary: vs } = content;
  lines.push(`Summary: ${vs.total} checked, ${vs.valid} valid, ${vs.invalid} error(s), ${vs.warnings} warning(s)`);

  console.log(lines.join('\n'));

  process.exit(vs.invalid > 0 ? 1 : 0);
}

run();
