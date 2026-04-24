#!/usr/bin/env node
'use strict';

/**
 * Spec update operations (FSD-014).
 *
 * Pairs with `plugin/scripts/spec.js` (which creates spec artifacts once via
 * /fsd-spec, refusing to overwrite) by supplying the ongoing-edits surface
 * the /fsd-spec-update skill dispatches to. Mirrors `roadmap.js`'s design —
 * surgical edits, byte-preservation of user prose in untouched regions,
 * re-validation before every write, idempotent no-ops for already-applied
 * edits, atomic tmp-file + rename.
 *
 * Four ops:
 * - update({ specPath, target, ... })     — surgical field/section rewrite
 * - approve({ specPath })                 — idempotent `approved: true`
 * - archive({ specPath })                 — idempotent `status: archived`
 * - supersede({ projectPath, config, newId, oldId })
 *     Adds oldId to newId's `supersedes:` + archives oldId. Preview-both-
 *     before-write. Best-effort rollback: if the second write fails, restore
 *     the first from an in-memory backup.
 *
 * Schema is unchanged — validateSpec already accepts every field these ops
 * edit (status, approved, supersedes, related, tags, title, updated).
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validateSpec, KEBAB_CASE, CROSS_REF } = require(path.join(__dirname, 'validator.js'));
const { resolveSpecPath, SECTION_ORDER, SECTION_META } = require(path.join(__dirname, 'spec.js'));

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Heading regex. Section bodies extend until the next `## ` or EOF.
const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const TITLE_HEADING = /^#\s+(.+?)\s*$/;

/**
 * Canonicalize a section heading (e.g. "Non-goals") to a SECTION_ORDER id
 * ("non_goals"). Returns null if the heading doesn't match any known id —
 * user-authored extra `##` blocks survive edits as sections with `id: null`.
 */
function canonicalSectionId(heading) {
  const norm = String(heading).toLowerCase().replace(/[-\s]+/g, '_');
  return SECTION_ORDER.includes(norm) ? norm : null;
}

// ---- parseSpec ----------------------------------------------------------

/**
 * Parse a spec file into a structured view for surgical edits.
 *
 * @param {string} content
 * @returns {{
 *   lines: string[],
 *   frontmatter: Object,
 *   frontmatterLines: [number, number],    // [open `---`, close `---`] inclusive
 *   bodyStart: number,                      // first line index after closing `---`
 *   titleLine: number | null,               // index of `# <title>` or null if absent
 *   sections: Array<{
 *     id: string | null,                    // SECTION_ORDER id, or null for unknown headings
 *     heading: string,                      // original heading text (not normalized)
 *     headingLine: number,
 *     range: [number, number],              // [headingLine, endLineExclusive]
 *     bodyContent: string,                  // section body text with leading/trailing blank lines trimmed
 *   }>,
 * }}
 */
function parseSpec(content) {
  const lines = content.split('\n');

  if (lines[0] !== '---') {
    throw new Error('parseSpec: file does not begin with `---` frontmatter delimiter');
  }
  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { frontmatterEnd = i; break; }
  }
  if (frontmatterEnd === -1) {
    throw new Error('parseSpec: unterminated frontmatter block (no closing `---`)');
  }
  const frontmatterText = lines.slice(1, frontmatterEnd).join('\n');
  const frontmatter = parseYaml(frontmatterText);
  const bodyStart = frontmatterEnd + 1;

  // Find title line (first `# ` after frontmatter).
  let titleLine = null;
  for (let i = bodyStart; i < lines.length; i++) {
    if (TITLE_HEADING.test(lines[i])) { titleLine = i; break; }
    // Stop scanning if we hit a section heading before any title — title is absent.
    if (SECTION_HEADING.test(lines[i])) break;
  }

  // Collect section heading indices.
  const headings = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(SECTION_HEADING);
    if (m) headings.push({ line: i, heading: m[1] });
  }

  const sections = headings.map((h, idx) => {
    const endLine = idx + 1 < headings.length ? headings[idx + 1].line : lines.length;
    // Body content is everything strictly after the heading line, up to endLine.
    const bodyLines = lines.slice(h.line + 1, endLine);
    // Trim leading/trailing blank lines for bodyContent (cosmetic only; range is untouched).
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

/**
 * Read + parse a spec file. Throws on missing file; parser errors bubble.
 */
function readSpec(specPath) {
  const content = fs.readFileSync(specPath, 'utf-8');
  return { content, parsed: parseSpec(content) };
}

// ---- frontmatter editing -----------------------------------------------

/**
 * Produce a new frontmatter block (including `---` fences) by applying
 * `updates` to the existing frontmatter text. Keys present in the original
 * are updated in place (preserving order and any keys we're not touching);
 * new keys are appended before the closing fence.
 *
 * update value semantics:
 *   - scalar (string/number/boolean) → emit `key: value`
 *   - array                          → emit `key:\n  - v1\n  - v2`; empty array deletes
 *   - null                           → delete the key
 *
 * Handles both scalar and block-sequence array continuation lines in the
 * original frontmatter. (Flow-style arrays are not emitted by any writer in
 * this codebase; if the original uses them, we still replace them cleanly
 * because we match on the leading `key:` line only.)
 *
 * @param {string[]} originalLines
 * @param {[number, number]} frontmatterRange - [openFence, closeFence]
 * @param {Object} updates
 * @returns {string[]} replacement frontmatter block lines (including fences)
 */
function rewriteFrontmatter(originalLines, frontmatterRange, updates) {
  const [start, end] = frontmatterRange;
  const out = [originalLines[start]]; // opening `---`
  const seen = new Set();

  for (let i = start + 1; i < end; i++) {
    const line = originalLines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (!m) {
      // Non-key line (e.g. block-sequence continuation from a previous key).
      // Emit as-is UNLESS the previous key is being deleted/replaced — in
      // which case we skip it to avoid orphan `  - …` entries.
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
    if (val === null) continue; // delete (skip this line AND any continuation handled above)
    out.push(...serializeKeyValue(key, val));
  }

  // Append any new keys that weren't present before.
  for (const key of Object.keys(updates)) {
    if (seen.has(key)) continue;
    const val = updates[key];
    if (val === null || val === undefined) continue;
    out.push(...serializeKeyValue(key, val));
  }
  out.push(originalLines[end]); // closing `---`
  return out;
}

function shouldSkipAsContinuation(line) {
  return /^\s+-\s/.test(line) || /^\s{2,}\S/.test(line);
}

/**
 * Determines whether the most recently seen scalar key (walking backward from
 * `i`) is one that's being replaced or deleted in `updates`. Used to decide
 * whether a continuation line (block-sequence array entry) should be skipped
 * from the rewritten output.
 */
function lastKeyIsReplaced(lines, i, start, updates) {
  for (let j = i - 1; j > start; j--) {
    const m = lines[j].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (m) return m[1] in updates;
  }
  return false;
}

function serializeKeyValue(key, val) {
  if (Array.isArray(val)) {
    if (val.length === 0) return []; // empty array deletes
    return [`${key}:`, ...val.map(v => `  - ${v}`)];
  }
  return [`${key}: ${val}`];
}

// ---- atomic write -------------------------------------------------------

/**
 * Parse newContent, validate frontmatter via validateSpec, then write
 * atomically (tmp + rename). On any failure (parse, validate) returns
 * `{ ok: false, reason }` WITHOUT touching disk — the on-disk file is
 * guaranteed unchanged.
 */
function writeSpecAtomic(specPath, newContent) {
  let parsed;
  try {
    parsed = parseSpec(newContent);
  } catch (e) {
    return { ok: false, reason: `parse failed on new content: ${e.message}` };
  }
  const validation = validateSpec(parsed.frontmatter);
  if (!validation.valid) {
    return { ok: false, reason: `validateSpec rejected the result: ${validation.errors.join('; ')}` };
  }
  const tmp = `${specPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, newContent);
  fs.renameSync(tmp, specPath);
  return { ok: true };
}

// ---- op helpers ---------------------------------------------------------

function assertFileExists(specPath) {
  if (!fs.existsSync(specPath)) {
    return { ok: false, reason: `spec not found at ${specPath}` };
  }
  return null;
}

function withUpdatedDate(updates) {
  return { ...updates, updated: today() };
}

function applyFrontmatterUpdates(content, frontmatterRange, lines, updates) {
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
 *   - related | tags                 — args: action (add|remove), value
 *   - section                        — args: sectionId (SECTION_ORDER), content
 */
function update({ specPath, target, value, action, sectionId, content }) {
  const miss = assertFileExists(specPath); if (miss) return miss;
  const { content: raw, parsed } = readSpec(specPath);
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
      // Rewrite frontmatter title + body `# <title>` heading.
      const updates = withUpdatedDate({ title: newTitle });
      const newFm = rewriteFrontmatter(lines, frontmatterLines, updates);
      const rest = lines.slice(frontmatterLines[1] + 1);
      const bodyLines = rest.slice();
      if (parsed.titleLine !== null) {
        // titleLine is absolute in `lines`; translate to index in `rest`.
        const relIdx = parsed.titleLine - (frontmatterLines[1] + 1);
        bodyLines[relIdx] = `# ${newTitle}`;
      }
      const newContent = [...newFm, ...bodyLines].join('\n');
      const res = writeSpecAtomic(specPath, newContent);
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
      const res = writeSpecAtomic(specPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    case 'related':
    case 'tags': {
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
      const res = writeSpecAtomic(specPath, newContent);
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
        return { ok: false, reason: `update section: section "${sectionId}" not found in spec body` };
      }
      const newBody = content.trim();
      if (section.bodyContent === newBody) {
        return { ok: true, written: false, reason: 'no change (section content identical)' };
      }
      // Replace [headingLine .. endLineExclusive) with heading + blank + newBody + blank.
      const newSectionLines = [
        `## ${SECTION_META[sectionId].heading}`,
        '',
        newBody,
        '',
      ];
      const before = lines.slice(0, section.range[0]);
      const after = lines.slice(section.range[1]);
      // Also bump frontmatter updated:.
      const fmUpdated = rewriteFrontmatter(lines, frontmatterLines, withUpdatedDate({}));
      const bodyBefore = before.slice(frontmatterLines[1] + 1);
      const newContent = [...fmUpdated, ...bodyBefore, ...newSectionLines, ...after].join('\n');
      const res = writeSpecAtomic(specPath, newContent);
      return res.ok ? { ok: true, written: true } : res;
    }

    default:
      return { ok: false, reason: `update: unknown target "${target}" (expected title|status|related|tags|section)` };
  }
}

// ---- op: approve --------------------------------------------------------

function approve({ specPath }) {
  const miss = assertFileExists(specPath); if (miss) return miss;
  const { content: raw, parsed } = readSpec(specPath);
  if (parsed.frontmatter.approved === true || parsed.frontmatter.approved === 'true') {
    return { ok: true, written: false, reason: 'already approved' };
  }
  const newContent = applyFrontmatterUpdates(raw, parsed.frontmatterLines, parsed.lines, withUpdatedDate({ approved: true }));
  const res = writeSpecAtomic(specPath, newContent);
  return res.ok ? { ok: true, written: true } : res;
}

// ---- op: archive --------------------------------------------------------

function archive({ specPath }) {
  const miss = assertFileExists(specPath); if (miss) return miss;
  const { content: raw, parsed } = readSpec(specPath);
  if (parsed.frontmatter.status === 'archived') {
    return { ok: true, written: false, reason: 'already archived' };
  }
  const newContent = applyFrontmatterUpdates(raw, parsed.frontmatterLines, parsed.lines, withUpdatedDate({ status: 'archived' }));
  const res = writeSpecAtomic(specPath, newContent);
  return res.ok ? { ok: true, written: true } : res;
}

// ---- op: supersede ------------------------------------------------------

/**
 * Add oldId to newId's supersedes + archive oldId. Best-effort atomic across
 * the two files: on the second write's failure, restore the first from an
 * in-memory backup so the spec dir isn't left in a half-applied state.
 */
function supersede({ projectPath, config, newId, oldId }) {
  if (!projectPath || !newId || !oldId) {
    return { ok: false, reason: 'supersede: projectPath, newId, and oldId are required' };
  }
  if (newId === oldId) {
    return { ok: false, reason: 'supersede: newId and oldId must differ' };
  }
  const newPath = resolveSpecPath({ projectPath, config, id: newId });
  const oldPath = resolveSpecPath({ projectPath, config, id: oldId });
  if (!fs.existsSync(newPath)) return { ok: false, reason: `supersede: new spec not found at ${newPath}` };
  if (!fs.existsSync(oldPath)) return { ok: false, reason: `supersede: old spec not found at ${oldPath}` };

  const newOriginal = fs.readFileSync(newPath, 'utf-8');
  const newParsed = parseSpec(newOriginal);
  const oldParsed = parseSpec(fs.readFileSync(oldPath, 'utf-8'));

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
    const r = writeSpecAtomic(newPath, newContent);
    if (!r.ok) return { ok: false, reason: `supersede: new spec write failed — ${r.reason}` };
    wroteNew = true;
  }

  if (!alreadyArchived) {
    const oldOriginal = fs.readFileSync(oldPath, 'utf-8');
    const oldContent = applyFrontmatterUpdates(
      oldOriginal, oldParsed.frontmatterLines, oldParsed.lines,
      withUpdatedDate({ status: 'archived' })
    );
    const r = writeSpecAtomic(oldPath, oldContent);
    if (!r.ok) {
      // Rollback the new spec write from the in-memory backup.
      if (wroteNew) {
        try {
          fs.writeFileSync(newPath, newOriginal);
        } catch (restoreErr) {
          return {
            ok: false,
            reason: `supersede: old spec write failed (${r.reason}); ALSO failed to restore new spec — ${restoreErr.message}. Manual cleanup needed at ${newPath}.`,
          };
        }
      }
      return { ok: false, reason: `supersede: old spec write failed — ${r.reason}; new spec restored from backup` };
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
//   node scripts/spec-update.js <projectPath> update --id=<id> --target=title --value="New Title"
//   node scripts/spec-update.js <projectPath> update --id=<id> --target=status --value=active
//   node scripts/spec-update.js <projectPath> update --id=<id> --target=related --action=add --value=plan/foo
//   node scripts/spec-update.js <projectPath> update --id=<id> --target=tags --action=remove --value=legacy
//   node scripts/spec-update.js <projectPath> update --id=<id> --target=section --section-id=problem --content="New body."
//   node scripts/spec-update.js <projectPath> approve --id=<id>
//   node scripts/spec-update.js <projectPath> archive --id=<id>
//   node scripts/spec-update.js <projectPath> supersede --new-id=<new> --old-id=<old>
if (require.main === module) {
  const [, , projectPath, opName, ...rest] = process.argv;
  const OPS = new Set(['update', 'approve', 'archive', 'supersede']);
  if (!projectPath || !opName || !OPS.has(opName)) {
    process.stderr.write(`usage: spec-update.js <projectPath> <${[...OPS].join('|')}> [--key=value ...]\n`);
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
    const specPath = resolveSpecPath({ projectPath, config, id: args.id });
    if (opName === 'approve') result = approve({ specPath });
    else if (opName === 'archive') result = archive({ specPath });
    else if (opName === 'update') {
      result = update({
        specPath,
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
  parseSpec,
  readSpec,
  writeSpecAtomic,
  rewriteFrontmatter,
  update,
  approve,
  archive,
  supersede,
  today,
};
