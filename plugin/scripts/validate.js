#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadContent, scanArtifacts } = require(path.join(__dirname, 'loader.js'));
const { loadConfig, resolveLayerPaths, getStructure } = require(path.join(__dirname, 'config.js'));
const { STORAGE_KINDS } = require(path.join(__dirname, 'validator.js'));

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

function formatArtifactLine(item) {
  const issues = [...item.validation.errors, ...item.validation.warnings];
  const issueStr = issues.length > 0 ? '   ' + issues.join('; ') : '';
  const status = item.status || '-';

  if (item.validation.errors.length > 0) {
    return `  ERR   ${item.id.padEnd(22)} ${status.padEnd(10)}${issueStr}`;
  }
  if (item.validation.warnings.length > 0) {
    return `  WARN  ${item.id.padEnd(22)} ${status.padEnd(10)}${issueStr}`;
  }
  return `  ok    ${item.id.padEnd(22)} ${status}`;
}

function summarizeArtifacts(items) {
  return {
    total: items.length,
    valid: items.filter(i => i.validation.valid).length,
    invalid: items.filter(i => !i.validation.valid).length,
    warnings: items.reduce((sum, i) => sum + i.validation.warnings.length, 0),
  };
}

const ARTIFACT_FLAG_TO_KIND = {
  '--specs': 'spec',
  '--plans': 'plan',
  '--research': 'research',
};

const KIND_HEADINGS = {
  spec: 'SPECS',
  plan: 'PLANS',
  research: 'RESEARCH',
};

const SCANNABLE_FLAGS = new Set(['--skills', '--agents', '--commands']);
const ARTIFACT_FLAGS = new Set(['--artifacts', ...Object.keys(ARTIFACT_FLAG_TO_KIND)]);

function run() {
  const pluginRoot = process.argv[2] || process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  const filter = process.argv[3] || '';

  const paths = resolveLayerPaths(pluginRoot);
  const config = loadConfig(paths);
  const structure = getStructure(config);

  const lines = [];
  lines.push('FSD Validation Report');
  lines.push('=====================');
  lines.push('');

  const isArtifactFilter = ARTIFACT_FLAGS.has(filter);
  const isScannableFilter = SCANNABLE_FLAGS.has(filter);

  // Decide which surfaces to inspect.
  // No flag → scannable kinds only (preserves session-start cost characteristics;
  // artifacts are inspected only when explicitly requested).
  const showScannable = !filter || isScannableFilter;
  const showArtifacts = isArtifactFilter;

  let scannableSummary = { total: 0, valid: 0, invalid: 0, warnings: 0 };
  let artifactSummary = { total: 0, valid: 0, invalid: 0, warnings: 0 };

  if (showScannable) {
    const content = loadContent({ ...paths, config });
    scannableSummary = content.validationSummary;

    const showSkills = !filter || filter === '--skills';
    const showAgents = !filter || filter === '--agents';
    const showCommands = !filter || filter === '--commands';

    if (showSkills && content.skills.length > 0) {
      lines.push(`SKILLS (${content.skills.length} checked)`);
      for (const s of content.skills) lines.push(formatValidationLine(s));
      lines.push('');
    }

    if (showAgents && content.agents.length > 0) {
      lines.push(`AGENTS (${content.agents.length} checked)`);
      for (const a of content.agents) lines.push(formatValidationLine(a));
      lines.push('');
    }

    if (showCommands && content.commands.length > 0) {
      lines.push(`COMMANDS (${content.commands.length} checked)`);
      for (const c of content.commands) lines.push(formatValidationLine(c));
      lines.push('');
    }
  }

  if (showArtifacts) {
    const kindsToScan = filter === '--artifacts'
      ? STORAGE_KINDS
      : [ARTIFACT_FLAG_TO_KIND[filter]];

    const allArtifacts = [];
    for (const kind of kindsToScan) {
      const items = scanArtifacts({
        fsdDir: paths.projectPath,
        kind,
        dirName: structure[kind],
      });
      allArtifacts.push(...items);

      lines.push(`${KIND_HEADINGS[kind]} (${items.length} checked)`);
      if (items.length === 0) {
        lines.push(`  (none in .fsd/${structure[kind]}/)`);
      } else {
        for (const item of items) lines.push(formatArtifactLine(item));
      }
      lines.push('');
    }
    artifactSummary = summarizeArtifacts(allArtifacts);
  }

  const total = scannableSummary.total + artifactSummary.total;
  const valid = scannableSummary.valid + artifactSummary.valid;
  const invalid = scannableSummary.invalid + artifactSummary.invalid;
  const warnings = scannableSummary.warnings + artifactSummary.warnings;
  lines.push(`Summary: ${total} checked, ${valid} valid, ${invalid} error(s), ${warnings} warning(s)`);

  console.log(lines.join('\n'));

  process.exit(invalid > 0 ? 1 : 0);
}

run();
