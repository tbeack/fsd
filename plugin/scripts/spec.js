#!/usr/bin/env node
'use strict';

/**
 * Spec authoring backing module (FSD-006).
 *
 * Pairs with the `/fsd:spec` skill, which interviews the user and delegates
 * the actual write here. This module owns render + validate + atomic write
 * for `.fsd/<structure.spec>/<id>.md` artifacts.
 *
 * Design notes:
 * - Create-only. Hard refuse to overwrite. Editing existing specs is
 *   explicitly out of scope for v1 (future `/fsd:spec-update`).
 * - Frontmatter is validated via `validateSpec` BEFORE touching disk. On
 *   validation failure, the file on disk is unchanged.
 * - `project:` is auto-injected from `planning/PROJECT.md` when a
 *   `planningDir` is passed and `specData.project` is absent. This is the
 *   reason for the PROJECT.md precondition the skill enforces in Step 1.
 * - Atomic write: tmp file + rename. Same pattern as `roadmap.js`.
 * - The body always contains all six section headings (Problem, Goals,
 *   Non-goals, Requirements, Acceptance, Open questions). A section the
 *   user skipped keeps its italic placeholder copy so the structure is
 *   present in the file for `/fsd:spec-update` to fill in later.
 */

const fs = require('fs');
const path = require('path');
const { validateSpec } = require(path.join(__dirname, 'validator.js'));
const { getStructure } = require(path.join(__dirname, 'config.js'));
const { loadProjectContext } = require(path.join(__dirname, 'loader.js'));

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Canonical section order + default placeholder copy. Section keys are stable
// identifiers that callers pass in specData.sections[key].
const SECTION_ORDER = ['problem', 'goals', 'non_goals', 'requirements', 'acceptance', 'open_questions'];
const SECTION_META = {
  problem:        { heading: 'Problem',        placeholder: "_What's the problem this spec addresses?_" },
  goals:          { heading: 'Goals',          placeholder: '_What this spec is trying to achieve._' },
  non_goals:      { heading: 'Non-goals',      placeholder: '_What this spec is deliberately NOT trying to do._' },
  requirements:   { heading: 'Requirements',   placeholder: '_Falsifiable requirements the implementation must satisfy._' },
  acceptance:     { heading: 'Acceptance',     placeholder: '- [ ] _Verification step_' },
  open_questions: { heading: 'Open questions', placeholder: '_Unknowns to resolve before implementation._' },
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
 * Build a spec file's full content (frontmatter + six body sections).
 *
 * @param {Object} data
 * @param {string}   data.project       - Human-readable project name (auto-injected by writeSpecFile from PROJECT.md when absent)
 * @param {string}   data.id            - kebab-case id; must match filename stem
 * @param {string}   data.title         - human-readable title
 * @param {string}  [data.status]       - draft|active|archived (default 'draft')
 * @param {string}  [data.created]      - ISO date (default today)
 * @param {string}  [data.updated]      - ISO date
 * @param {boolean} [data.approved]     - default false; only serialized when true
 * @param {string[]}[data.related]      - cross-refs like 'spec/foo', 'plan/bar'
 * @param {string[]}[data.tags]         - kebab-case tags
 * @param {string[]}[data.supersedes]   - kebab-case spec ids this spec replaces
 * @param {Object}  [data.sections]     - keyed body content; missing keys fall back to placeholders
 * @returns {string}
 */
function renderSpec(data) {
  const meta = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'draft',
    created: data.created || today(),
  };
  if (data.updated) meta.updated = data.updated;
  if (data.approved === true) meta.approved = true; // default false is omitted
  if (Array.isArray(data.related) && data.related.length) meta.related = data.related;
  if (Array.isArray(data.tags) && data.tags.length) meta.tags = data.tags;
  if (Array.isArray(data.supersedes) && data.supersedes.length) meta.supersedes = data.supersedes;

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
 * Resolve the target spec file path for a given project, honoring
 * config.structure.spec overrides.
 *
 * @param {Object} opts
 * @param {string}  opts.projectPath
 * @param {Object} [opts.config]
 * @param {string}  opts.id
 * @returns {string} absolute-style path under <projectPath>/<structure.spec>/
 */
function resolveSpecPath({ projectPath, config, id }) {
  const structure = getStructure(config || {});
  return path.join(projectPath, structure.spec, `${id}.md`);
}

// ---- write --------------------------------------------------------------

/**
 * Write a new spec file under `<projectPath>/<structure.spec>/<id>.md`.
 *
 * Behavior:
 * - Auto-injects `project:` from `<planningDir>/PROJECT.md` when
 *   `specData.project` is absent and a `planningDir` is provided. If
 *   PROJECT.md is missing or invalid, returns `{ ok: false, reason }` and
 *   does NOT write.
 * - Refuses to overwrite an existing target file.
 * - Runs `validateSpec` on the rendered meta BEFORE writing. On failure,
 *   returns `{ ok: false, reason }` with the target file absent on disk.
 * - Writes atomically (tmp + rename) so a concurrent reader never sees
 *   a half-written file.
 *
 * @param {Object} opts
 * @param {string}  opts.projectPath    - .fsd/ directory (structure.spec hangs off here)
 * @param {Object} [opts.config]        - Merged config; defaults to {} (structure resolves to DEFAULT_STRUCTURE)
 * @param {string} [opts.planningDir]   - repo's planning/ dir for PROJECT.md auto-injection
 * @param {Object}  opts.specData       - fields for renderSpec
 * @returns {{ ok: boolean, written?: string[], skipped?: string[], reason?: string }}
 */
function writeSpecFile({ projectPath, config, planningDir, specData }) {
  if (!projectPath) {
    return { ok: false, written: [], skipped: [], reason: 'writeSpecFile: projectPath is required' };
  }
  if (!specData || typeof specData !== 'object') {
    return { ok: false, written: [], skipped: [], reason: 'writeSpecFile: specData is required' };
  }

  const data = { ...specData };

  // Auto-inject project from planning/PROJECT.md when the caller didn't
  // supply it directly. This is the point of the PROJECT.md precondition
  // the /fsd:spec skill enforces in Step 1.
  if (!data.project && planningDir) {
    const ctx = loadProjectContext({ planningDir });
    if (!ctx.project) {
      return {
        ok: false,
        written: [],
        skipped: [],
        reason: `PROJECT.md not found under ${planningDir} — run /fsd:new-project first or pass specData.project explicitly`,
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
    return { ok: false, written: [], skipped: [], reason: 'specData.id is required' };
  }
  if (!data.title) {
    return { ok: false, written: [], skipped: [], reason: 'specData.title is required' };
  }

  const targetPath = resolveSpecPath({ projectPath, config, id: data.id });

  if (fs.existsSync(targetPath)) {
    return {
      ok: false,
      written: [],
      skipped: [targetPath],
      reason: `refusing to overwrite existing file: ${targetPath}`,
    };
  }

  // Build the exact meta shape renderSpec will emit, then validate.
  const metaForValidation = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'draft',
    created: data.created || today(),
  };
  if (data.updated) metaForValidation.updated = data.updated;
  if (data.approved === true) metaForValidation.approved = true;
  if (Array.isArray(data.related) && data.related.length) metaForValidation.related = data.related;
  if (Array.isArray(data.tags) && data.tags.length) metaForValidation.tags = data.tags;
  if (Array.isArray(data.supersedes) && data.supersedes.length) metaForValidation.supersedes = data.supersedes;

  const validation = validateSpec(metaForValidation);
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
  fs.writeFileSync(tmp, renderSpec(data));
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
//   node scripts/spec.js <projectPath> --json=<path>
//   node scripts/spec.js <projectPath> --id=... --title=... [--status=...]
//     [--approved=true|false] [--related=spec/foo,plan/bar] [--tags=a,b]
//     [--supersedes=foo,bar] [--sections-json=<path>]
//     [--planning-dir=<path>] [--project=<string>]
//
// On success prints `{ ok: true, written: [...], skipped: [] }` and exits 0.
// On failure prints `{ ok: false, reason: "..." }` and exits 1.
// Usage/invocation problems exit 2.
if (require.main === module) {
  const [, , projectPath, ...rest] = process.argv;
  if (!projectPath) {
    process.stderr.write('usage: spec.js <projectPath> [--json=<path> | --id=... --title=... ...]\n');
    process.exit(2);
  }
  const args = parseCliArgs(rest);

  let specData;
  if (args.json) {
    try {
      specData = JSON.parse(fs.readFileSync(args.json, 'utf-8'));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, reason: `failed to read --json payload: ${e.message}` }) + '\n');
      process.exit(1);
    }
  } else {
    specData = {
      id: args.id,
      title: args.title,
      status: args.status,
      approved: args.approved === true,
    };
    if (args.project) specData.project = args.project;
    if (args.updated) specData.updated = args.updated;
    if (args.related) specData.related = splitCsv(args.related);
    if (args.tags) specData.tags = splitCsv(args.tags);
    if (args.supersedes) specData.supersedes = splitCsv(args.supersedes);
    if (args.sectionsJson) {
      try {
        specData.sections = JSON.parse(fs.readFileSync(args.sectionsJson, 'utf-8'));
      } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, reason: `failed to read --sections-json: ${e.message}` }) + '\n');
        process.exit(1);
      }
    }
  }

  // Load config from the standard three-layer resolution so structure.spec
  // overrides apply. Swallow failures (defensive; fall back to defaults).
  let config = {};
  try {
    const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, 'config.js'));
    config = loadConfig(resolveLayerPaths());
  } catch (_) {
    config = {};
  }

  const planningDir = args.planningDir || path.resolve(projectPath, '..', 'planning');

  const result = writeSpecFile({ projectPath, config, planningDir, specData });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  renderSpec,
  writeSpecFile,
  resolveSpecPath,
  today,
  SECTION_ORDER,
  SECTION_META,
};
