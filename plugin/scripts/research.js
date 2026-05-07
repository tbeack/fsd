#!/usr/bin/env node
'use strict';

/**
 * Research artifact authoring backing module (FSD-010).
 *
 * Pairs with the `/fsd:research` skill, which interviews the user and
 * delegates the actual write here. This module owns render + validate +
 * atomic write for `.fsd/<structure.research>/<id>.md` artifacts.
 *
 * Design notes:
 * - Create-only. Hard refuse to overwrite. Editing existing research
 *   artifacts is explicitly out of scope for v1.
 * - Frontmatter is validated via `validateResearch` BEFORE touching disk.
 * - `project:` is auto-injected from `planning/PROJECT.md` when a
 *   `planningDir` is passed and `researchData.project` is absent.
 * - Atomic write: tmp file + rename. Same pattern as `spec.js`.
 * - The body always contains all six section headings (Question, Context,
 *   Method, Findings, Conclusion, Open questions). A section the user
 *   skipped keeps its italic placeholder so the structure is present for
 *   future editing.
 */

const fs = require('fs');
const path = require('path');
const { validateResearch } = require(path.join(__dirname, 'validator.js'));
const { getStructure } = require(path.join(__dirname, 'config.js'));
const { loadProjectContext } = require(path.join(__dirname, 'loader.js'));

function today() {
  return new Date().toISOString().slice(0, 10);
}

const SECTION_ORDER = ['question', 'context', 'method', 'findings', 'conclusion', 'open_questions'];
const SECTION_META = {
  question:       { heading: 'Question',       placeholder: '_What is being investigated?_' },
  context:        { heading: 'Context',        placeholder: '_Why this research is needed and what prompted it._' },
  method:         { heading: 'Method',         placeholder: '_How the investigation was approached._' },
  findings:       { heading: 'Findings',       placeholder: '_What was discovered._' },
  conclusion:     { heading: 'Conclusion',     placeholder: '_The final recommendation or answer._' },
  open_questions: { heading: 'Open questions', placeholder: '_Follow-up unknowns._' },
};

// ---- serialization ------------------------------------------------------

function yamlLine(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
  }
  return `${key}: ${value}`;
}

/**
 * Build a research file's full content (frontmatter + six body sections).
 *
 * @param {Object} data
 * @param {string}   data.project       - Human-readable project name (auto-injected by writeResearchFile from PROJECT.md when absent)
 * @param {string}   data.id            - kebab-case id; must match filename stem
 * @param {string}   data.title         - human-readable title
 * @param {string}  [data.status]       - draft|active|archived (default 'draft')
 * @param {string}  [data.created]      - ISO date (default today)
 * @param {string}  [data.updated]      - ISO date
 * @param {string[]}[data.related]      - cross-refs like 'spec/foo', 'plan/bar'
 * @param {string[]}[data.tags]         - kebab-case tags
 * @param {string[]}[data.sources]      - http(s) URL strings
 * @param {string}  [data.conclusion]   - one-line summary of the conclusion
 * @param {Object}  [data.sections]     - keyed body content; missing keys fall back to placeholders
 * @returns {string}
 */
function renderResearch(data) {
  const meta = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'draft',
    created: data.created || today(),
  };
  if (data.updated) meta.updated = data.updated;
  if (Array.isArray(data.related) && data.related.length) meta.related = data.related;
  if (Array.isArray(data.tags) && data.tags.length) meta.tags = data.tags;
  if (Array.isArray(data.sources) && data.sources.length) meta.sources = data.sources;
  if (data.conclusion && typeof data.conclusion === 'string' && data.conclusion.trim()) {
    meta.conclusion = data.conclusion.trim();
  }

  const lines = ['---'];
  for (const key of Object.keys(meta)) lines.push(yamlLine(key, meta[key]));
  lines.push('---', '', `# ${data.title}`, '');

  const sections = data.sections || {};
  for (const id of SECTION_ORDER) {
    const { heading, placeholder } = SECTION_META[id];
    const raw = sections[id];
    const content = (typeof raw === 'string' && raw.trim().length > 0) ? raw.trim() : placeholder;
    lines.push(`## ${heading}`, '', content, '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

// ---- path resolution ----------------------------------------------------

/**
 * Resolve the target research file path for a given project, honoring
 * config.structure.research overrides.
 *
 * @param {Object} opts
 * @param {string}  opts.projectPath
 * @param {Object} [opts.config]
 * @param {string}  opts.id
 * @returns {string} absolute-style path under <projectPath>/<structure.research>/
 */
function resolveResearchPath({ projectPath, config, id }) {
  const structure = getStructure(config || {});
  return path.join(projectPath, structure.research, `${id}.md`);
}

// ---- write --------------------------------------------------------------

/**
 * Write a new research file under `<projectPath>/<structure.research>/<id>.md`.
 *
 * Behavior:
 * - Auto-injects `project:` from `<planningDir>/PROJECT.md` when
 *   `researchData.project` is absent and a `planningDir` is provided.
 * - Refuses to overwrite an existing target file.
 * - Runs `validateResearch` on the rendered meta BEFORE writing.
 * - Writes atomically (tmp + rename).
 *
 * @param {Object} opts
 * @param {string}  opts.projectPath    - .fsd/ directory
 * @param {Object} [opts.config]        - Merged config; defaults to {}
 * @param {string} [opts.planningDir]   - repo's planning/ dir for PROJECT.md auto-injection
 * @param {Object}  opts.researchData   - fields for renderResearch
 * @returns {{ ok: boolean, written?: string[], skipped?: string[], reason?: string }}
 */
function writeResearchFile({ projectPath, config, planningDir, researchData }) {
  if (!projectPath) {
    return { ok: false, written: [], skipped: [], reason: 'writeResearchFile: projectPath is required' };
  }
  if (!researchData || typeof researchData !== 'object') {
    return { ok: false, written: [], skipped: [], reason: 'writeResearchFile: researchData is required' };
  }

  const data = { ...researchData };

  // Auto-inject project from planning/PROJECT.md when the caller didn't
  // supply it directly.
  if (!data.project && planningDir) {
    const ctx = loadProjectContext({ planningDir });
    if (!ctx.project) {
      return {
        ok: false,
        written: [],
        skipped: [],
        reason: `PROJECT.md not found under ${planningDir} — run /fsd:new-project first or pass researchData.project explicitly`,
      };
    }
    if (!ctx.project.validation.valid) {
      return {
        ok: false,
        written: [],
        skipped: [],
        reason: `PROJECT.md invalid — cannot auto-inject project: ${ctx.project.validation.errors.join('; ')}`,
      };
    }
    data.project = ctx.project.meta.project;
  }

  if (!data.id) {
    return { ok: false, written: [], skipped: [], reason: 'researchData.id is required' };
  }
  if (!data.title) {
    return { ok: false, written: [], skipped: [], reason: 'researchData.title is required' };
  }

  const targetPath = resolveResearchPath({ projectPath, config, id: data.id });

  if (fs.existsSync(targetPath)) {
    return {
      ok: false,
      written: [],
      skipped: [targetPath],
      reason: `refusing to overwrite existing file: ${targetPath}`,
    };
  }

  // Build the exact meta shape renderResearch will emit, then validate.
  const metaForValidation = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'draft',
    created: data.created || today(),
  };
  if (data.updated) metaForValidation.updated = data.updated;
  if (Array.isArray(data.related) && data.related.length) metaForValidation.related = data.related;
  if (Array.isArray(data.tags) && data.tags.length) metaForValidation.tags = data.tags;
  if (Array.isArray(data.sources) && data.sources.length) metaForValidation.sources = data.sources;
  if (data.conclusion && typeof data.conclusion === 'string' && data.conclusion.trim()) {
    metaForValidation.conclusion = data.conclusion.trim();
  }

  const validation = validateResearch(metaForValidation);
  if (!validation.valid) {
    return {
      ok: false,
      written: [],
      skipped: [],
      reason: `invalid frontmatter: ${validation.errors.join('; ')}`,
    };
  }

  // Atomic write: ensure parent dir, write tmp, rename into place.
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, renderResearch(data));
  fs.renameSync(tmp, targetPath);

  return { ok: true, written: [targetPath], skipped: [] };
}

// ---- CLI entry ----------------------------------------------------------

function parseCliArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=([\s\S]*))?$/);
    if (!m) continue;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = m[2] === undefined ? 'true' : m[2];
    if (val === 'true') out[key] = true;
    else if (val === 'false') out[key] = false;
    else out[key] = val;
  }
  return out;
}

function splitCsv(v) {
  if (!v) return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

// Usage:
//   node scripts/research.js <projectPath> --json=<path>
//   node scripts/research.js <projectPath> --id=... --title=... [--status=...]
//     [--related=spec/foo,plan/bar] [--tags=a,b]
//     [--sources=https://...,https://...] [--conclusion=<string>]
//     [--sections-json=<path>] [--planning-dir=<path>] [--project=<string>]
//
// On success prints `{ ok: true, written: [...], skipped: [] }` and exits 0.
// On failure prints `{ ok: false, reason: "..." }` and exits 1.
if (require.main === module) {
  const [, , projectPath, ...rest] = process.argv;
  if (!projectPath) {
    process.stderr.write('usage: research.js <projectPath> [--json=<path> | --id=... --title=... ...]\n');
    process.exit(2);
  }
  const args = parseCliArgs(rest);

  let researchData;
  if (args.json) {
    try {
      researchData = JSON.parse(fs.readFileSync(args.json, 'utf-8'));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, reason: `failed to read --json payload: ${e.message}` }) + '\n');
      process.exit(1);
    }
  } else {
    researchData = {
      id: args.id,
      title: args.title,
      status: args.status,
    };
    if (args.project) researchData.project = args.project;
    if (args.updated) researchData.updated = args.updated;
    if (args.related) researchData.related = splitCsv(args.related);
    if (args.tags) researchData.tags = splitCsv(args.tags);
    if (args.sources) researchData.sources = splitCsv(args.sources);
    if (args.conclusion) researchData.conclusion = args.conclusion;
    if (args.sectionsJson) {
      try {
        researchData.sections = JSON.parse(fs.readFileSync(args.sectionsJson, 'utf-8'));
      } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, reason: `failed to read --sections-json: ${e.message}` }) + '\n');
        process.exit(1);
      }
    }
  }

  let config = {};
  try {
    const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, 'config.js'));
    config = loadConfig(resolveLayerPaths());
  } catch (_) {
    config = {};
  }

  const planningDir = args.planningDir || path.resolve(projectPath, '..', 'planning');

  const result = writeResearchFile({ projectPath, config, planningDir, researchData });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  renderResearch,
  writeResearchFile,
  resolveResearchPath,
  today,
  SECTION_ORDER,
  SECTION_META,
};
