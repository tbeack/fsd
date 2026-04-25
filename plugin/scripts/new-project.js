#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateProject, validateRoadmap } = require(path.join(__dirname, 'validator.js'));

const PROJECT_FILENAME = 'PROJECT.md';
const ROADMAP_FILENAME = 'ROADMAP.md';

/**
 * Serialize a value for a YAML scalar line. The bundled parser only supports
 * flat key-value pairs, one-level nested objects, and block/flow arrays of
 * strings — so we keep the output inside that surface. Arrays are emitted as
 * block sequences (one `-` per line) which round-trips cleanly.
 */
function yamlLine(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .filter(k => typeof value[k] === 'string' && value[k].length > 0)
      .map(k => `  ${k}: ${value[k]}`);
    if (entries.length === 0) return `${key}: {}`;
    return `${key}:\n${entries.join('\n')}`;
  }
  return `${key}: ${value}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function bodySection(title, content) {
  return `## ${title}\n\n${content.trim()}\n`;
}

/**
 * Build the PROJECT.md file body (frontmatter + markdown).
 *
 * @param {Object} data
 * @param {string} data.project        - Human-readable project name
 * @param {string} data.id             - Kebab-case slug (frontmatter id)
 * @param {string} data.title          - Document title
 * @param {string} [data.status]       - draft|active|archived (default 'active')
 * @param {string} [data.created]      - ISO date (default today)
 * @param {string} [data.vision]       - One-line project vision
 * @param {string[]} [data.target_users] - Array of target user descriptors
 * @param {Object} [data.verification]   - Optional repo-wide verification command map
 *                                         `{ tests?, validate?, typecheck?, lint? }`
 *                                         consumed by `/fsd:execute-plan` after each
 *                                         plan phase. Omit or leave empty to skip.
 * @param {Object} [data.sections]     - Markdown body content keyed by section
 * @returns {string}
 */
function renderProject(data) {
  const meta = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'active',
    created: data.created || today(),
  };
  if (data.vision) meta.vision = data.vision;
  if (Array.isArray(data.target_users) && data.target_users.length) {
    meta.target_users = data.target_users;
  }
  if (data.verification && typeof data.verification === 'object' && !Array.isArray(data.verification)) {
    const filtered = Object.keys(data.verification)
      .filter(k => typeof data.verification[k] === 'string' && data.verification[k].length > 0)
      .reduce((acc, k) => { acc[k] = data.verification[k]; return acc; }, {});
    if (Object.keys(filtered).length) meta.verification = filtered;
  }

  const lines = ['---'];
  for (const key of Object.keys(meta)) lines.push(yamlLine(key, meta[key]));
  lines.push('---', '');
  lines.push(`# ${data.title}`, '');

  const s = data.sections || {};
  lines.push(bodySection('Identity', s.identity || `${data.project} — ${data.vision || ''}`.trim()));
  lines.push(bodySection('Scope', s.scope || '_In-scope:_\n\n_Out-of-scope:_'));
  lines.push(bodySection('Tech Context', s.tech_context || '_Language / framework / key constraints_'));
  lines.push(bodySection('Success Metrics', s.success_metrics || '_How we know this is working_'));
  lines.push(bodySection('Anti-goals', s.anti_goals || '_What we are deliberately not doing_'));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

/**
 * Build the ROADMAP.md file body (frontmatter + markdown).
 *
 * @param {Object} data
 * @param {string} data.project        - Human-readable project name
 * @param {string} data.id             - Kebab-case slug for the roadmap doc
 * @param {string} data.title          - Document title
 * @param {string} data.version        - Semver-like string
 * @param {string} data.current_milestone - Milestone id (matches a `## Milestone <id>` heading)
 * @param {string} [data.status]       - draft|active|archived
 * @param {string} [data.created]      - ISO date
 * @param {Array<{id, version, name, goal, phases: Array<{id, title, goal}>}>} [data.milestones]
 * @returns {string}
 */
function renderRoadmap(data) {
  const meta = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'active',
    created: data.created || today(),
    version: data.version,
    current_milestone: data.current_milestone,
  };

  const lines = ['---'];
  for (const key of Object.keys(meta)) lines.push(yamlLine(key, meta[key]));
  lines.push('---', '');
  lines.push(`# ${data.title}`, '');

  const milestones = Array.isArray(data.milestones) && data.milestones.length
    ? data.milestones
    : [{
        id: data.current_milestone,
        version: data.version,
        name: 'Initial Milestone',
        goal: '_Milestone goal in 1–2 sentences._',
        phases: [{ id: `${data.current_milestone}.1`, title: 'Phase 1', goal: '_Phase goal in one paragraph._' }],
      }];

  for (const m of milestones) {
    lines.push(`## Milestone ${m.id}`, '');
    lines.push(`**Version:** ${m.version}`, '');
    lines.push(`**Name:** ${m.name}`, '');
    lines.push(`**Goal:** ${m.goal}`, '');
    const phases = Array.isArray(m.phases) ? m.phases : [];
    for (const p of phases) {
      lines.push(`### Phase ${p.id} — ${p.title}`, '');
      lines.push(p.goal, '');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

/**
 * Write PROJECT.md and ROADMAP.md to the given planning directory. Refuses
 * (no-op, returns { ok: false, ... }) if either file already exists — this is
 * a one-time kickoff skill; re-running it should never clobber existing
 * content. Creates the planning dir if it does not exist.
 *
 * @param {Object} opts
 * @param {string} opts.planningDir       - Directory to write into
 * @param {Object} opts.projectData       - Data for renderProject
 * @param {Object} opts.roadmapData       - Data for renderRoadmap
 * @returns {{ ok: boolean, written: string[], skipped: string[], reason?: string }}
 */
function writeProjectFiles({ planningDir, projectData, roadmapData }) {
  const projectPath = path.join(planningDir, PROJECT_FILENAME);
  const roadmapPath = path.join(planningDir, ROADMAP_FILENAME);

  const existing = [];
  if (fs.existsSync(projectPath)) existing.push(PROJECT_FILENAME);
  if (fs.existsSync(roadmapPath)) existing.push(ROADMAP_FILENAME);
  if (existing.length) {
    return {
      ok: false,
      written: [],
      skipped: existing,
      reason: `refusing to overwrite existing file(s): ${existing.join(', ')}`,
    };
  }

  // Validate the rendered frontmatter before writing — so a bad call site
  // fails loud at the backing module, not silently on disk.
  const projectValidation = validateProject({
    ...projectData,
    status: projectData.status || 'active',
    created: projectData.created || today(),
  });
  const roadmapValidation = validateRoadmap({
    ...roadmapData,
    status: roadmapData.status || 'active',
    created: roadmapData.created || today(),
  });
  if (!projectValidation.valid || !roadmapValidation.valid) {
    return {
      ok: false,
      written: [],
      skipped: [],
      reason: `invalid frontmatter — project: [${projectValidation.errors.join('; ')}], roadmap: [${roadmapValidation.errors.join('; ')}]`,
    };
  }

  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(projectPath, renderProject(projectData));
  fs.writeFileSync(roadmapPath, renderRoadmap(roadmapData));

  return { ok: true, written: [projectPath, roadmapPath], skipped: [] };
}

module.exports = {
  renderProject,
  renderRoadmap,
  writeProjectFiles,
  PROJECT_FILENAME,
  ROADMAP_FILENAME,
};
