#!/usr/bin/env node
'use strict';

/**
 * Plan update operations (FSD-015).
 *
 * Pairs with `plugin/scripts/plan.js` (which creates plan artifacts once via
 * /fsd-plan, refusing to overwrite) by supplying the ongoing-edits surface
 * the /fsd-plan-update skill dispatches to. Mirrors `spec-update.js`'s
 * design — surgical edits, byte-preservation of user prose in untouched
 * regions, re-validation before every write, idempotent no-ops for
 * already-applied edits, atomic tmp-file + rename.
 *
 * Three ops:
 * - update({ planPath, target, ... })    — surgical field/section rewrite
 * - archive({ planPath })                — idempotent `status: archived`
 * - supersede({ projectPath, config, newId, oldId })
 *     Adds oldId to newId's `supersedes:` + archives oldId. Preview-both-
 *     before-write. Best-effort rollback: if the second write fails, restore
 *     the first from an in-memory backup.
 *
 * Schema extension is tiny: validatePlan gains an optional `supersedes`
 * field (kebab-case array), mirroring validateSpec.supersedes byte-for-byte.
 *
 * `update` sub-surface (8 targets):
 *   - title                          — frontmatter + body `# <title>`
 *   - status                         — draft|active; archived forbidden
 *   - related | tags | depends_on    — add/remove one array entry
 *   - task | estimate                — set non-empty string | clear
 *   - section                        — rewrite one of six body sections
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validatePlan, KEBAB_CASE, CROSS_REF } = require(path.join(__dirname, 'validator.js'));
const { resolvePlanPath, SECTION_ORDER, SECTION_META } = require(path.join(__dirname, 'plan.js'));

function today() {
  return new Date().toISOString().slice(0, 10);
}

const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const TITLE_HEADING = /^#\s+(.+?)\s*$/;

function canonicalSectionId(heading) {
  const norm = String(heading).toLowerCase().replace(/[-\s]+/g, '_');
  return SECTION_ORDER.includes(norm) ? norm : null;
}

// ---- parsePlan ----------------------------------------------------------

/**
 * Parse a plan file into a structured view for surgical edits.
 *
 * @param {string} content
 * @returns {{
 *   lines: string[],
 *   frontmatter: Object,
 *   frontmatterLines: [number, number],
 *   bodyStart: number,
 *   titleLine: number | null,
 *   sections: Array<{
 *     id: string | null,
 *     heading: string,
 *     headingLine: number,
 *     range: [number, number],
 *     bodyContent: string,
 *   }>,
 * }}
 */
function parsePlan(content) {
  const lines = content.split('\n');

  if (lines[0] !== '---') {
    throw new Error('parsePlan: file does not begin with `---` frontmatter delimiter');
  }
  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { frontmatterEnd = i; break; }
  }
  if (frontmatterEnd === -1) {
    throw new Error('parsePlan: unterminated frontmatter block (no closing `---`)');
  }
  const frontmatterText = lines.slice(1, frontmatterEnd).join('\n');
  const frontmatter = parseYaml(frontmatterText);
  const bodyStart = frontmatterEnd + 1;

  let titleLine = null;
  for (let i = bodyStart; i < lines.length; i++) {
    if (TITLE_HEADING.test(lines[i])) { titleLine = i; break; }
    if (SECTION_HEADING.test(lines[i])) break;
  }

  const headings = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(SECTION_HEADING);
    if (m) headings.push({ line: i, heading: m[1] });
  }

  const sections = headings.map((h, idx) => {
    const endLine = idx + 1 < headings.length ? headings[idx + 1].line : lines.length;
    const bodyLines = lines.slice(h.line + 1, endLine);
    let bs = 0;
    while (bs < bodyLines.length && bodyLines[bs].trim() === '') bs++;
    let be = bodyLines.length;
    while (be > bs && bodyLines[be - 1].trim() === '') be--;
    const bodyContent = bodyLines.slice(bs, be).join('\n');

    return {
      id: canonicalSectionId(h.heading),
      heading: h.heading,
      headingLine: h.line,
      range: [h.line, endLine],
      bodyContent,
    };
  });

  return { lines, frontmatter, frontmatterLines: [0, frontmatterEnd], bodyStart, titleLine, sections };
}

function readPlan(planPath) {
  const content = fs.readFileSync(planPath, 'utf-8');
  return { content, parsed: parsePlan(content) };
}

// ---- frontmatter editing -----------------------------------------------

/**
 * Produce a new frontmatter block (including `---` fences) by applying
 * `updates` to the existing frontmatter text. Keys present in the original
 * are updated in place (preserving order); new keys are appended before the
 * closing fence.
 *
 * update value semantics:
 *   - scalar (string/number/boolean) → emit `key: value`
 *   - array                          → emit `key:\n  - v1\n  - v2`; empty array deletes
 *   - null                           → delete the key
 */
function rewriteFrontmatter(originalLines, frontmatterRange, updates) {
  const [start, end] = frontmatterRange;
  const out = [originalLines[start]];
  const seen = new Set();

  for (let i = start + 1; i < end; i++) {
    const line = originalLines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (!m) {
      if (shouldSkipAsContinuation(line) && lastKeyIsReplaced(originalLines, i, start, updates)) continue;
      out.push(line);
      continue;
    }
    const key = m[1];
    if (!(key in updates)) {
      out.push(line);
      continue;
    }
    seen.add(key);
    const val = updates[key];
    if (val === null) continue;
    out.push(...serializeKeyValue(key, val));
  }

  for (const key of Object.keys(updates)) {
    if (seen.has(key)) continue;
    const val = updates[key];
    if (val === null || val === undefined) continue;
    out.push(...serializeKeyValue(key, val));
  }
  out.push(originalLines[end]);
  return out;
}

function shouldSkipAsContinuation(line) {
  return /^\s+-\s/.test(line) || /^\s{2,}\S/.test(line);
}

function lastKeyIsReplaced(lines, i, start, updates) {
  for (let j = i - 1; j > start; j--) {
    const m = lines[j].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (m) return m[1] in updates;
  }
  return false;
}

function serializeKeyValue(key, val) {
  if (Array.isArray(val)) {
    if (val.length === 0) return [];
    return [`${key}:`, ...val.map(v => `  - ${v}`)];
  }
  return [`${key}: ${val}`];
}

// ---- atomic write -------------------------------------------------------

/**
 * Parse newContent, validate frontmatter via validatePlan, then write
 * atomically (tmp + rename). On any failure (parse, validate) returns
 * `{ ok: false, reason }` WITHOUT touching disk.
 */
function writePlanAtomic(planPath, newContent) {
  let parsed;
  try {
    parsed = parsePlan(newContent);
  } catch (e) {
    return { ok: false, reason: `parse failed on new content: ${e.message}` };
  }
  const validation = validatePlan(parsed.frontmatter);
  if (!validation.valid) {
    return { ok: false, reason: `validatePlan rejected the result: ${validation.errors.join('; ')}` };
  }
  const tmp = `${planPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, newContent);
  fs.renameSync(tmp, planPath);
  return { ok: true };
}

// ---- op helpers ---------------------------------------------------------

function assertFileExists(planPath) {
  if (!fs.existsSync(planPath)) {
    return { ok: false, reason: `plan not found at ${planPath}` };
  }
  return null;
}

function withUpdatedDate(updates) {
  return { ...updates, updated: today() };
}

function applyFrontmatterUpdates(_content, frontmatterRange, lines, updates) {
  const newFrontmatter = rewriteFrontmatter(lines, frontmatterRange, updates);
  const rest = lines.slice(frontmatterRange[1] + 1);
  return [...newFrontmatter, ...rest].join('\n');
}

// ---- op: update ---------------------------------------------------------

/**
 * Surgical edit dispatcher. Single `target` per call.
 *
 * Targets:
 *   - title                          — args: value
 *   - status                         — args: value (draft|active; archived forbidden)
 *   - related | tags | depends_on    — args: action (add|remove), value
 *   - task | estimate                — args: action (set|clear), value (set only)
 *   - section                        — args: sectionId (SECTION_ORDER), content
 */
function update({ planPath, target, value, action, sectionId, content }) {
  const miss = assertFileExists(planPath); if (miss) return miss;
  const { content: raw, parsed } = readPlan(planPath);
  const { lines, frontmatter, frontmatterLines } = parsed;

  switch (target) {
    case 'title': {
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: false, reason: 'update title: value must be a non-empty string' };
      }
      const newTitle = value.trim();
      if (frontmatter.title === newTitle) {
        return { ok: true, written: false, reason: 'no change (title identical)' };
      }
      const updates = withUpdatedDate({ title: newTitle });
      const newFm = rewriteFrontmatter(lines, frontmatterLines, updates);
      const rest = lines.slice(frontmatterLines[1] + 1);
      const bodyLines = rest.slice();
      if (parsed.titleLine !== null) {
        const relIdx = parsed.titleLine - (frontmatterLines[1] + 1);
        bodyLines[relIdx] = `# ${newTitle}`;
      }
      const newContent = [...newFm, ...bodyLines].join('\n');
      const res = writePlanAtomic(planPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    case 'status': {
      if (value === 'archived') {
        return { ok: false, reason: 'update status: use the archive op to set status to archived' };
      }
      if (value !== 'draft' && value !== 'active') {
        return { ok: false, reason: `update status: value must be draft or active (got "${value}")` };
      }
      if (frontmatter.status === value) {
        return { ok: true, written: false, reason: `no change (status already ${value})` };
      }
      const newContent = applyFrontmatterUpdates(raw, frontmatterLines, lines, withUpdatedDate({ status: value }));
      const res = writePlanAtomic(planPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    case 'related':
    case 'tags':
    case 'depends_on': {
      const regex = target === 'related' ? CROSS_REF : KEBAB_CASE;
      if (action !== 'add' && action !== 'remove') {
        return { ok: false, reason: `update ${target}: action must be "add" or "remove"` };
      }
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, reason: `update ${target}: value is required` };
      }
      if (action === 'add' && !regex.test(value)) {
        return { ok: false, reason: `update ${target}: "${value}" does not match required pattern` };
      }
      const current = Array.isArray(frontmatter[target]) ? frontmatter[target].slice() : [];
      if (action === 'add') {
        if (current.includes(value)) {
          return { ok: true, written: false, reason: `no change ("${value}" already in ${target})` };
        }
        current.push(value);
      } else {
        const before = current.length;
        const filtered = current.filter(v => v !== value);
        if (filtered.length === before) {
          return { ok: false, reason: `update ${target}: "${value}" not present in ${target} (nothing to remove)` };
        }
        current.length = 0;
        current.push(...filtered);
      }
      const updates = withUpdatedDate({ [target]: current });
      const newContent = applyFrontmatterUpdates(raw, frontmatterLines, lines, updates);
      const res = writePlanAtomic(planPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    case 'task':
    case 'estimate': {
      if (action !== 'set' && action !== 'clear') {
        return { ok: false, reason: `update ${target}: action must be "set" or "clear"` };
      }
      if (action === 'set') {
        if (typeof value !== 'string' || value.length === 0) {
          return { ok: false, reason: `update ${target}: value must be a non-empty string for action=set` };
        }
        if (frontmatter[target] === value) {
          return { ok: true, written: false, reason: `no change (${target} already "${value}")` };
        }
        const newContent = applyFrontmatterUpdates(raw, frontmatterLines, lines, withUpdatedDate({ [target]: value }));
        const res = writePlanAtomic(planPath, newContent);
        return res.ok ? { ok: true, written: true } : res;
      }
      // action === 'clear'
      if (frontmatter[target] === undefined) {
        return { ok: true, written: false, reason: `no change (${target} already absent)` };
      }
      const newContent = applyFrontmatterUpdates(raw, frontmatterLines, lines, withUpdatedDate({ [target]: null }));
      const res = writePlanAtomic(planPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    case 'section': {
      if (!SECTION_ORDER.includes(sectionId)) {
        return { ok: false, reason: `update section: sectionId must be one of ${SECTION_ORDER.join(', ')}` };
      }
      if (typeof content !== 'string' || content.trim().length === 0) {
        return { ok: false, reason: 'update section: content must be a non-empty string' };
      }
      const section = parsed.sections.find(s => s.id === sectionId);
      if (!section) {
        return { ok: false, reason: `update section: section "${sectionId}" not found in plan body` };
      }
      const newBody = content.trim();
      if (section.bodyContent === newBody) {
        return { ok: true, written: false, reason: 'no change (section content identical)' };
      }
      const newSectionLines = [
        `## ${SECTION_META[sectionId].heading}`,
        '',
        newBody,
        '',
      ];
      const before = lines.slice(0, section.range[0]);
      const after = lines.slice(section.range[1]);
      const fmUpdated = rewriteFrontmatter(lines, frontmatterLines, withUpdatedDate({}));
      const bodyBefore = before.slice(frontmatterLines[1] + 1);
      const newContent = [...fmUpdated, ...bodyBefore, ...newSectionLines, ...after].join('\n');
      const res = writePlanAtomic(planPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    default:
      return { ok: false, reason: `update: unknown target "${target}" (expected title|status|related|tags|depends_on|task|estimate|section)` };
  }
}

// ---- op: archive --------------------------------------------------------

function archive({ planPath }) {
  const miss = assertFileExists(planPath); if (miss) return miss;
  const { content: raw, parsed } = readPlan(planPath);
  if (parsed.frontmatter.status === 'archived') {
    return { ok: true, written: false, reason: 'already archived' };
  }
  const newContent = applyFrontmatterUpdates(raw, parsed.frontmatterLines, parsed.lines, withUpdatedDate({ status: 'archived' }));
  const res = writePlanAtomic(planPath, newContent);
  return res.ok ? { ok: true, written: true } : res;
}

// ---- op: supersede ------------------------------------------------------

/**
 * Add oldId to newId's supersedes + archive oldId. Best-effort atomic across
 * the two files: on the second write's failure, restore the first from an
 * in-memory backup so the plan dir isn't left in a half-applied state.
 */
function supersede({ projectPath, config, newId, oldId }) {
  if (!projectPath || !newId || !oldId) {
    return { ok: false, reason: 'supersede: projectPath, newId, and oldId are required' };
  }
  if (newId === oldId) {
    return { ok: false, reason: 'supersede: newId and oldId must differ' };
  }
  const newPath = resolvePlanPath({ projectPath, config, id: newId });
  const oldPath = resolvePlanPath({ projectPath, config, id: oldId });
  if (!fs.existsSync(newPath)) return { ok: false, reason: `supersede: new plan not found at ${newPath}` };
  if (!fs.existsSync(oldPath)) return { ok: false, reason: `supersede: old plan not found at ${oldPath}` };

  const newOriginal = fs.readFileSync(newPath, 'utf-8');
  const newParsed = parsePlan(newOriginal);
  const oldParsed = parsePlan(fs.readFileSync(oldPath, 'utf-8'));

  const alreadyListed = Array.isArray(newParsed.frontmatter.supersedes) && newParsed.frontmatter.supersedes.includes(oldId);
  const alreadyArchived = oldParsed.frontmatter.status === 'archived';

  if (alreadyListed && alreadyArchived) {
    return { ok: true, written: false, reason: 'already superseded + archived' };
  }

  let wroteNew = false;
  if (!alreadyListed) {
    const currentSupers = Array.isArray(newParsed.frontmatter.supersedes) ? newParsed.frontmatter.supersedes.slice() : [];
    currentSupers.push(oldId);
    const newContent = applyFrontmatterUpdates(
      newOriginal, newParsed.frontmatterLines, newParsed.lines,
      withUpdatedDate({ supersedes: currentSupers })
    );
    const r = writePlanAtomic(newPath, newContent);
    if (!r.ok) return { ok: false, reason: `supersede: new plan write failed — ${r.reason}` };
    wroteNew = true;
  }

  if (!alreadyArchived) {
    const oldOriginal = fs.readFileSync(oldPath, 'utf-8');
    const oldContent = applyFrontmatterUpdates(
      oldOriginal, oldParsed.frontmatterLines, oldParsed.lines,
      withUpdatedDate({ status: 'archived' })
    );
    const r = writePlanAtomic(oldPath, oldContent);
    if (!r.ok) {
      if (wroteNew) {
        try {
          fs.writeFileSync(newPath, newOriginal);
        } catch (restoreErr) {
          return {
            ok: false,
            reason: `supersede: old plan write failed (${r.reason}); ALSO failed to restore new plan — ${restoreErr.message}. Manual cleanup needed at ${newPath}.`,
          };
        }
      }
      return { ok: false, reason: `supersede: old plan write failed — ${r.reason}; new plan restored from backup` };
    }
  }

  return { ok: true, written: true };
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

// Usage:
//   node scripts/plan-update.js <projectPath> update --id=<id> --target=title --value="New Title"
//   node scripts/plan-update.js <projectPath> update --id=<id> --target=status --value=active
//   node scripts/plan-update.js <projectPath> update --id=<id> --target=related|tags|depends_on --action=add|remove --value=<v>
//   node scripts/plan-update.js <projectPath> update --id=<id> --target=task|estimate --action=set|clear [--value=<v>]
//   node scripts/plan-update.js <projectPath> update --id=<id> --target=section --section-id=<id> --content="..."
//   node scripts/plan-update.js <projectPath> archive --id=<id>
//   node scripts/plan-update.js <projectPath> supersede --new-id=<new> --old-id=<old>
if (require.main === module) {
  const [, , projectPath, opName, ...rest] = process.argv;
  const OPS = new Set(['update', 'archive', 'supersede']);
  if (!projectPath || !opName || !OPS.has(opName)) {
    process.stderr.write(`usage: plan-update.js <projectPath> <${[...OPS].join('|')}> [--key=value ...]\n`);
    process.exit(2);
  }
  const args = parseCliArgs(rest);

  let config = {};
  try {
    const { loadConfig, resolveLayerPaths } = require(path.join(__dirname, 'config.js'));
    config = loadConfig(resolveLayerPaths());
  } catch (_) {
    config = {};
  }

  let result;
  if (opName === 'supersede') {
    result = supersede({ projectPath, config, newId: args.newId, oldId: args.oldId });
  } else {
    if (!args.id) {
      process.stdout.write(JSON.stringify({ ok: false, reason: `${opName}: --id is required` }) + '\n');
      process.exit(1);
    }
    const planPath = resolvePlanPath({ projectPath, config, id: args.id });
    if (opName === 'archive') result = archive({ planPath });
    else if (opName === 'update') {
      result = update({
        planPath,
        target: args.target,
        value: args.value,
        action: args.action,
        sectionId: args.sectionId,
        content: args.content,
      });
    }
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  parsePlan,
  readPlan,
  writePlanAtomic,
  rewriteFrontmatter,
  update,
  archive,
  supersede,
  today,
};
