#!/usr/bin/env node
'use strict';

/**
 * Plan authoring backing module (FSD-008).
 *
 * Pairs with the `/fsd-plan` skill, which runs a guided technical-planning
 * session inside Claude Code's native plan mode and delegates the final
 * write here. This module owns render + validate + atomic write for
 * `.fsd/<structure.plan>/<id>.md` plan artifacts.
 *
 * Design notes:
 * - Create-only. Refuses to overwrite. Editing existing plans (status flips,
 *   phase appends, depends_on edits) is explicitly out of scope for v1; a
 *   future `/fsd-plan-update` skill will own it (mirrors the FSD-006 →
 *   FSD-014 spec pattern).
 * - Hard-requires a spec linkage: `planData.related` must contain at least
 *   one `spec/<id>` entry pointing at a real file in
 *   `<fsdDir>/<structure.spec>/<id>.md`. Archived specs are refused;
 *   unapproved specs are surfaced as a non-fatal warning.
 * - Frontmatter is validated via `validatePlan` BEFORE touching disk. On
 *   validation failure, the file on disk is unchanged.
 * - `project:` is auto-injected from `planning/PROJECT.md` when a
 *   `planningDir` is passed and `planData.project` is absent.
 * - Body always carries all six section headings (Context, Approach,
 *   Phases, Risks, Acceptance, Open questions). Skipped sections keep their
 *   italic placeholder so a future `/fsd-plan-update` can fill them in.
 * - Atomic write: tmp file + rename.
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validatePlan, validateSpec } = require(path.join(__dirname, 'validator.js'));
const { getStructure } = require(path.join(__dirname, 'config.js'));
const { loadProjectContext } = require(path.join(__dirname, 'loader.js'));

function today() {
  return new Date().toISOString().slice(0, 10);
}

const SECTION_ORDER = ['context', 'approach', 'phases', 'risks', 'acceptance', 'open_questions'];
const SECTION_META = {
  context:        { heading: 'Context',        placeholder: '_Spec summary + relevant code + prior decisions touched by this plan._' },
  approach:       { heading: 'Approach',       placeholder: '_High-level architectural strategy._' },
  phases:         { heading: 'Phases',         placeholder: '_Phase-by-phase implementation breakdown with concrete steps._' },
  risks:          { heading: 'Risks',          placeholder: '_Known gotchas and mitigations._' },
  acceptance:     { heading: 'Acceptance',     placeholder: '- [ ] _Falsifiable verification step_' },
  open_questions: { heading: 'Open questions', placeholder: '_Anything deferred or still unclear at write time._' },
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
 * Build a plan file's full content (frontmatter + six body sections).
 *
 * @param {Object} data
 * @param {string}   data.project       - Human-readable project name (auto-injected by writePlanFile from PROJECT.md when absent)
 * @param {string}   data.id            - kebab-case id; must match filename stem
 * @param {string}   data.title         - human-readable title
 * @param {string}  [data.status]       - draft|active|archived (default 'draft')
 * @param {string}  [data.created]      - ISO date (default today)
 * @param {string}  [data.updated]      - ISO date
 * @param {string}  [data.task]         - Optional FSD-NNN identifier
 * @param {string[]}[data.depends_on]   - kebab-case plan ids that must complete first
 * @param {string}  [data.estimate]     - Free-form estimate string (e.g. "~2 days")
 * @param {string[]}[data.related]      - cross-refs like 'spec/foo', 'plan/bar' — hard-requires at least one spec/<id>
 * @param {string[]}[data.tags]         - kebab-case tags
 * @param {Object}  [data.sections]     - keyed body content; missing keys fall back to placeholders
 * @returns {string}
 */
function renderPlan(data) {
  const meta = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'draft',
    created: data.created || today(),
  };
  if (data.updated) meta.updated = data.updated;
  if (data.task) meta.task = data.task;
  if (Array.isArray(data.depends_on) && data.depends_on.length) meta.depends_on = data.depends_on;
  if (data.estimate) meta.estimate = data.estimate;
  if (Array.isArray(data.related) && data.related.length) meta.related = data.related;
  if (Array.isArray(data.tags) && data.tags.length) meta.tags = data.tags;

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
 * Resolve the target plan file path for a given project, honoring
 * config.structure.plan overrides.
 *
 * @param {Object} opts
 * @param {string}  opts.projectPath   - The .fsd/ directory
 * @param {Object} [opts.config]       - Merged config; defaults to {}
 * @param {string}  opts.id
 * @returns {string}
 */
function resolvePlanPath({ projectPath, config, id }) {
  const structure = getStructure(config || {});
  return path.join(projectPath, structure.plan, `${id}.md`);
}

// ---- spec precondition --------------------------------------------------

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return parseYaml(match[1]);
}

/**
 * Verify the state of a linked spec. Returns:
 *   { ok: false, reason }                          — spec missing
 *   { ok: false, reason, archived: true }          — spec archived
 *   { ok: true,  spec, warnings: [] }              — spec active + approved
 *   { ok: true,  spec, warnings: [...] }           — spec active + unapproved (soft warn)
 *
 * @param {Object} opts
 * @param {string}  opts.fsdDir     - The .fsd/ directory
 * @param {Object} [opts.config]
 * @param {string}  opts.specId
 * @returns {Object}
 */
function checkSpecPrecondition({ fsdDir, config, specId }) {
  if (!fsdDir) return { ok: false, reason: 'checkSpecPrecondition: fsdDir is required' };
  if (!specId) return { ok: false, reason: 'checkSpecPrecondition: specId is required' };

  const structure = getStructure(config || {});
  const specPath = path.join(fsdDir, structure.spec, `${specId}.md`);

  if (!fs.existsSync(specPath)) {
    return {
      ok: false,
      reason: `linked spec not found at ${specPath} — create it with /fsd-spec first`,
    };
  }

  const content = fs.readFileSync(specPath, 'utf-8');
  const meta = extractFrontmatter(content);
  const validation = validateSpec(meta);

  if (meta.status === 'archived') {
    return {
      ok: false,
      reason: `linked spec "${specId}" is archived — pick an active spec, or supersede the archived one first`,
      archived: true,
      spec: { path: specPath, meta, validation },
    };
  }

  const warnings = [];
  // validator allows stringy "false" too, so normalize.
  const approved = meta.approved === true || meta.approved === 'true';
  if (!approved) {
    warnings.push(`linked spec "${specId}" has approved: false — plans drafted against unapproved specs may need rework if the spec shifts`);
  }

  return { ok: true, spec: { path: specPath, meta, validation }, warnings };
}

// ---- write --------------------------------------------------------------

/**
 * Write a new plan file under `<projectPath>/<structure.plan>/<id>.md`.
 *
 * Behavior:
 * - Auto-injects `project:` from `<planningDir>/PROJECT.md` when absent in
 *   `planData` and `planningDir` is supplied.
 * - Hard-requires spec linkage: `planData.related` must contain at least
 *   one `spec/<id>` entry, and the referenced spec file must exist AND not
 *   be archived. Unapproved spec → returns `{ ok: true, written, warnings }`.
 * - Refuses to overwrite an existing plan file.
 * - Pre-validates via `validatePlan` BEFORE writing.
 * - Atomic write: tmp + rename.
 *
 * @param {Object} opts
 * @param {string}  opts.projectPath   - The .fsd/ directory
 * @param {Object} [opts.config]
 * @param {string} [opts.planningDir]
 * @param {Object}  opts.planData
 * @param {boolean} [opts.acknowledgeUnapproved]  - Engineer explicitly opted in to drafting against an unapproved spec; suppresses the soft-warning refusal
 * @returns {{ ok: boolean, written?: string[], skipped?: string[], reason?: string, warnings?: string[] }}
 */
function writePlanFile({ projectPath, config, planningDir, planData, acknowledgeUnapproved = false }) {
  if (!projectPath) {
    return { ok: false, written: [], skipped: [], reason: 'writePlanFile: projectPath is required' };
  }
  if (!planData || typeof planData !== 'object') {
    return { ok: false, written: [], skipped: [], reason: 'writePlanFile: planData is required' };
  }

  const data = { ...planData };

  // Auto-inject project from planning/PROJECT.md when caller didn't supply.
  if (!data.project && planningDir) {
    const ctx = loadProjectContext({ planningDir });
    if (!ctx.project) {
      return {
        ok: false,
        written: [],
        skipped: [],
        reason: `PROJECT.md not found under ${planningDir} — run /fsd-new-project first or pass planData.project explicitly`,
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
    return { ok: false, written: [], skipped: [], reason: 'planData.id is required' };
  }
  if (!data.title) {
    return { ok: false, written: [], skipped: [], reason: 'planData.title is required' };
  }

  // Spec-hard-require: at least one related entry must point at a real spec.
  const specLinks = (data.related || []).filter(r => typeof r === 'string' && r.startsWith('spec/'));
  if (specLinks.length === 0) {
    return {
      ok: false,
      written: [],
      skipped: [],
      reason: 'plan must link to a spec via `related: spec/<id>` — /fsd-plan hard-requires a spec linkage',
    };
  }

  const aggregateWarnings = [];
  for (const link of specLinks) {
    const specId = link.slice('spec/'.length);
    const check = checkSpecPrecondition({ fsdDir: projectPath, config, specId });
    if (!check.ok) {
      return { ok: false, written: [], skipped: [], reason: check.reason };
    }
    if (check.warnings && check.warnings.length) {
      aggregateWarnings.push(...check.warnings);
    }
  }
  if (aggregateWarnings.length && !acknowledgeUnapproved) {
    return {
      ok: false,
      written: [],
      skipped: [],
      reason: `linked spec has unresolved warnings — pass acknowledgeUnapproved: true to proceed. Warnings: ${aggregateWarnings.join('; ')}`,
      warnings: aggregateWarnings,
    };
  }

  const targetPath = resolvePlanPath({ projectPath, config, id: data.id });

  if (fs.existsSync(targetPath)) {
    return {
      ok: false,
      written: [],
      skipped: [targetPath],
      reason: `refusing to overwrite existing file: ${targetPath}`,
    };
  }

  // Build the meta shape renderPlan will emit, then validate.
  const metaForValidation = {
    project: data.project,
    id: data.id,
    title: data.title,
    status: data.status || 'draft',
    created: data.created || today(),
  };
  if (data.updated) metaForValidation.updated = data.updated;
  if (data.task) metaForValidation.task = data.task;
  if (Array.isArray(data.depends_on) && data.depends_on.length) metaForValidation.depends_on = data.depends_on;
  if (data.estimate) metaForValidation.estimate = data.estimate;
  if (Array.isArray(data.related) && data.related.length) metaForValidation.related = data.related;
  if (Array.isArray(data.tags) && data.tags.length) metaForValidation.tags = data.tags;

  const validation = validatePlan(metaForValidation);
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
  fs.writeFileSync(tmp, renderPlan(data));
  fs.renameSync(tmp, targetPath);

  return {
    ok: true,
    written: [targetPath],
    skipped: [],
    ...(aggregateWarnings.length ? { warnings: aggregateWarnings } : {}),
  };
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
//   node scripts/plan.js <projectPath> --json=<path>
//   node scripts/plan.js <projectPath> --id=... --title=... --related=spec/foo [...]
//     [--status=...] [--task=FSD-NNN] [--depends-on=a,b] [--estimate=...]
//     [--tags=a,b] [--sections-json=<path>]
//     [--planning-dir=<path>] [--project=<string>]
//     [--acknowledge-unapproved]
//
// Prints `{ ok, written?, skipped?, reason?, warnings? }` JSON on stdout.
// Exit 0 on success, 1 on op failure, 2 on invocation error.
if (require.main === module) {
  const [, , projectPath, ...rest] = process.argv;
  if (!projectPath) {
    process.stderr.write('usage: plan.js <projectPath> [--json=<path> | --id=... --title=... --related=spec/<id> ...]\n');
    process.exit(2);
  }
  const args = parseCliArgs(rest);

  let planData;
  if (args.json) {
    try {
      planData = JSON.parse(fs.readFileSync(args.json, 'utf-8'));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, reason: `failed to read --json payload: ${e.message}` }) + '\n');
      process.exit(1);
    }
  } else {
    planData = {
      id: args.id,
      title: args.title,
      status: args.status,
    };
    if (args.project) planData.project = args.project;
    if (args.updated) planData.updated = args.updated;
    if (args.task) planData.task = args.task;
    if (args.dependsOn) planData.depends_on = splitCsv(args.dependsOn);
    if (args.estimate) planData.estimate = args.estimate;
    if (args.related) planData.related = splitCsv(args.related);
    if (args.tags) planData.tags = splitCsv(args.tags);
    if (args.sectionsJson) {
      try {
        planData.sections = JSON.parse(fs.readFileSync(args.sectionsJson, 'utf-8'));
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
  const acknowledgeUnapproved = args.acknowledgeUnapproved === true;

  const result = writePlanFile({ projectPath, config, planningDir, planData, acknowledgeUnapproved });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  renderPlan,
  writePlanFile,
  resolvePlanPath,
  checkSpecPrecondition,
  today,
  SECTION_ORDER,
  SECTION_META,
};
