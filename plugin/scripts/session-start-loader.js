#!/usr/bin/env node
'use strict';

const path = require('path');

const pluginRoot = process.argv[2]
  || process.env.CLAUDE_PLUGIN_ROOT
  || path.resolve(__dirname, '..');

const { resolveLayerPaths, loadConfig } = require(path.join(pluginRoot, 'scripts', 'config.js'));
const { loadContent } = require(path.join(pluginRoot, 'scripts', 'loader.js'));

const paths = resolveLayerPaths(pluginRoot);
const config = loadConfig(paths);
const { skills, agents, validationSummary, projectContext } = loadContent({ ...paths, config });

// --- formatting helpers ---

function pad(str, len) {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 3) + '...';
}

function formatRow(name, layer, description) {
  return `  ${pad(name, 22)}${pad(layer, 10)}${truncate(description, 50)}`;
}

// --- build output ---

const lines = [];

lines.push('FSD Framework Active');
lines.push('====================');

// One-line project header — shown only when BOTH files are present AND valid.
// Hidden on any absence or schema failure so session start never emits
// scary errors; `/fsd:validate` is the correct surface for that.
if (
  projectContext &&
  projectContext.project &&
  projectContext.roadmap &&
  projectContext.project.validation.valid &&
  projectContext.roadmap.validation.valid
) {
  const p = projectContext.project.meta;
  const r = projectContext.roadmap.meta;
  lines.push('');
  lines.push(`Project: ${p.project} — Milestone: ${r.current_milestone} (v${r.version})`);
}

if (skills.length > 0) {
  lines.push('');
  lines.push(`SKILLS (${skills.length} active)`);
  for (const s of skills) {
    lines.push(formatRow(s.name, s.layer, s.description));
  }
}

if (agents.length > 0) {
  lines.push('');
  lines.push(`AGENTS (${agents.length} active)`);
  for (const a of agents) {
    lines.push(formatRow(a.name, a.layer, a.description));
  }
}

// Show validation issues if any
if (validationSummary.invalid > 0 || validationSummary.warnings > 0) {
  lines.push('');
  const parts = [];
  if (validationSummary.invalid > 0) parts.push(`${validationSummary.invalid} error(s)`);
  if (validationSummary.warnings > 0) parts.push(`${validationSummary.warnings} warning(s)`);
  lines.push(`VALIDATION: ${parts.join(', ')} (run /fsd:validate for details)`);
}

const layerParts = [
  `core (${paths.corePath})`,
  `user (${paths.userPath})`,
  `project (${paths.projectPath})`,
];

lines.push('');
lines.push(`Layers: ${layerParts.join(' | ')}`);
lines.push('Commands: /fsd:list, /fsd:add, /fsd:init, /fsd:validate');
lines.push('');

process.stdout.write(lines.join('\n'));
