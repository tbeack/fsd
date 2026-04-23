#!/usr/bin/env node
'use strict';

/**
 * ROADMAP.md maintenance operations (FSD-007).
 *
 * Pairs with `plugin/scripts/new-project.js` (which creates the file once via
 * /fsd-new-project, refusing to overwrite) by supplying the ongoing-edits
 * surface the /fsd-roadmap skill dispatches to.
 *
 * Design notes:
 * - Edits are surgical. The parser records line-range pairs for frontmatter
 *   and every milestone/phase section so each op splices the file directly,
 *   never re-rendering untouched regions. This keeps user-authored goal
 *   prose byte-preserved across edits (tested).
 * - Every op re-validates the rendered frontmatter via validateRoadmap
 *   before touching disk. On failure, the file on disk is unchanged.
 * - Completion is tracked via `**Status:** shipped (YYYY-MM-DD)` body
 *   markers — no schema change from FSD-005. advance + completePhase detect
 *   an existing marker and no-op instead of double-inserting (idempotent).
 * - The bundled yaml-parser handles frontmatter parsing. For serialization
 *   we rewrite the frontmatter block line-by-line (not round-trip from the
 *   parser) so key order and formatting are preserved.
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validateRoadmap, SEMVER_LIKE, KEBAB_CASE } = require(path.join(__dirname, 'validator.js'));

// ---- primitives ---------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

const MILESTONE_HEADING = /^## Milestone (\S+)\s*$/;
const PHASE_HEADING = /^### Phase (\S+)(?:\s+—\s+(.*))?\s*$/;
const STATUS_SHIPPED = /^\*\*Status:\*\*\s+shipped\s+\(\d{4}-\d{2}-\d{2}\)\s*$/;
const VERSION_LINE = /^\*\*Version:\*\*\s+(\S+)\s*$/;

// ---- parseRoadmap -------------------------------------------------------

/**
 * Parse a ROADMAP.md file into a structured view for surgical edits.
 *
 * @param {string} content
 * @returns {{
 *   lines: string[],
 *   frontmatter: Object,
 *   frontmatterLines: [number, number],      // [start, end] inclusive of `---` lines
 *   bodyStart: number,                        // first line index after closing `---`
 *   milestones: Array<{
 *     id: string,
 *     headingLine: number,
 *     range: [number, number],                // [startLine, endLineExclusive]
 *     version: string | null,
 *     versionLine: number | null,
 *     shippedStatusLine: number | null,
 *     phases: Array<{
 *       id: string,
 *       title: string,
 *       headingLine: number,
 *       range: [number, number],
 *       shippedStatusLine: number | null,
 *     }>,
 *   }>,
 * }}
 */
function parseRoadmap(content) {
  const lines = content.split('\n');

  // Frontmatter must be the first non-empty block delimited by `---` lines.
  if (lines[0] !== '---') {
    throw new Error('parseRoadmap: file does not begin with `---` frontmatter delimiter');
  }
  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { frontmatterEnd = i; break; }
  }
  if (frontmatterEnd === -1) {
    throw new Error('parseRoadmap: unterminated frontmatter block (no closing `---`)');
  }
  const frontmatterText = lines.slice(1, frontmatterEnd).join('\n');
  const frontmatter = parseYaml(frontmatterText);
  const bodyStart = frontmatterEnd + 1;

  // Collect milestone heading line indices.
  const milestoneLines = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(MILESTONE_HEADING);
    if (m) milestoneLines.push({ line: i, id: m[1] });
  }

  const milestones = milestoneLines.map((m, idx) => {
    const endLine = idx + 1 < milestoneLines.length ? milestoneLines[idx + 1].line : lines.length;
    const section = lines.slice(m.line, endLine);
    const milestone = {
      id: m.id,
      headingLine: m.line,
      range: [m.line, endLine],
      version: null,
      versionLine: null,
      shippedStatusLine: null,
      phases: [],
    };
    // Scan milestone body for Version / Status / phase headings.
    const phaseLines = [];
    for (let j = 0; j < section.length; j++) {
      const absLine = m.line + j;
      if (j === 0) continue; // skip the `## Milestone …` heading itself
      const line = section[j];
      if (milestone.version === null) {
        const v = line.match(VERSION_LINE);
        if (v) { milestone.version = v[1]; milestone.versionLine = absLine; }
      }
      if (milestone.shippedStatusLine === null && STATUS_SHIPPED.test(line)) {
        // A Status line *outside* any phase counts as the milestone's marker.
        // We'll fix up after collecting phase boundaries.
        milestone.shippedStatusLine = absLine;
      }
      if (PHASE_HEADING.test(line)) {
        const pm = line.match(PHASE_HEADING);
        phaseLines.push({ line: absLine, id: pm[1], title: pm[2] || '' });
      }
    }
    // If the milestone's shipped status line was actually *inside* a phase, it
    // belongs to that phase — we attribute it below. Resolve here.
    const firstPhaseLine = phaseLines.length ? phaseLines[0].line : Infinity;
    if (milestone.shippedStatusLine !== null && milestone.shippedStatusLine >= firstPhaseLine) {
      milestone.shippedStatusLine = null;
    }
    // Build phases with ranges.
    milestone.phases = phaseLines.map((p, pidx) => {
      const pEnd = pidx + 1 < phaseLines.length ? phaseLines[pidx + 1].line : endLine;
      let shipped = null;
      for (let k = p.line + 1; k < pEnd; k++) {
        if (STATUS_SHIPPED.test(lines[k])) { shipped = k; break; }
      }
      return {
        id: p.id,
        title: p.title,
        headingLine: p.line,
        range: [p.line, pEnd],
        shippedStatusLine: shipped,
      };
    });
    return milestone;
  });

  return {
    lines,
    frontmatter,
    frontmatterLines: [0, frontmatterEnd],
    bodyStart,
    milestones,
  };
}

/**
 * Read + parse a ROADMAP.md file.
 * @param {string} roadmapPath
 */
function readRoadmap(roadmapPath) {
  const content = fs.readFileSync(roadmapPath, 'utf-8');
  return { content, parsed: parseRoadmap(content) };
}

// ---- frontmatter editing -----------------------------------------------

/**
 * Produce a new frontmatter block (including the `---` fences) by applying
 * `updates` to the existing frontmatter text. Keys present in the original
 * text are updated in place (preserving order + any comments we don't know
 * about); new keys are appended before the closing fence. Set an update value
 * to `null` to delete the key.
 *
 * Only simple scalar lines (`key: value`) are handled — arrays/objects inside
 * the frontmatter are not touched by these ops, matching the scope of the
 * roadmap schema (version / current_milestone / updated etc. are all scalars).
 *
 * @param {string[]} originalLines - The full file lines
 * @param {[number, number]} frontmatterRange - [startFence, endFence]
 * @param {Object} updates - { key: newValue | null }
 * @returns {string[]} replacement lines for the frontmatter block (including fences)
 */
function rewriteFrontmatter(originalLines, frontmatterRange, updates) {
  const [start, end] = frontmatterRange;
  const out = [originalLines[start]]; // opening `---`
  const seen = new Set();

  for (let i = start + 1; i < end; i++) {
    const line = originalLines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (!m) { out.push(line); continue; }
    const key = m[1];
    if (!(key in updates)) { out.push(line); continue; }
    seen.add(key);
    if (updates[key] === null) continue; // delete
    out.push(`${key}: ${updates[key]}`);
  }
  // Append any new keys that weren't present before.
  for (const key of Object.keys(updates)) {
    if (seen.has(key) || updates[key] === null) continue;
    out.push(`${key}: ${updates[key]}`);
  }
  out.push(originalLines[end]); // closing `---`
  return out;
}

// ---- splice helpers -----------------------------------------------------

function spliceLines(lines, range, replacement) {
  return [...lines.slice(0, range[0]), ...replacement, ...lines.slice(range[1])];
}

function insertAt(lines, index, inserted) {
  return [...lines.slice(0, index), ...inserted, ...lines.slice(index)];
}

// ---- atomic write -------------------------------------------------------

/**
 * Parse the new content's frontmatter and validate via validateRoadmap. On
 * success, write atomically (tmp file + rename). On failure, returns an
 * error result WITHOUT touching disk — the on-disk file is guaranteed
 * unchanged. Callers bubble the result up to the op return.
 *
 * @param {string} roadmapPath
 * @param {string} newContent
 * @returns {{ ok: boolean, reason?: string }}
 */
function writeRoadmapAtomic(roadmapPath, newContent) {
  let parsed;
  try {
    parsed = parseRoadmap(newContent);
  } catch (e) {
    return { ok: false, reason: `parse failed on new content: ${e.message}` };
  }
  const validation = validateRoadmap(parsed.frontmatter);
  if (!validation.valid) {
    return { ok: false, reason: `validateRoadmap rejected the result: ${validation.errors.join('; ')}` };
  }
  const tmp = `${roadmapPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, newContent);
  fs.renameSync(tmp, roadmapPath);
  return { ok: true };
}

// ---- op: addMilestone ---------------------------------------------------

function validateId(id) {
  return typeof id === 'string' && id.length > 0 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

function addMilestone({ roadmapPath, id, version, name, goal, setCurrent = false }) {
  if (!validateId(id)) return { ok: false, reason: `addMilestone: invalid id "${id}"` };
  if (!SEMVER_LIKE.test(String(version || ''))) return { ok: false, reason: `addMilestone: version must be semver-like (got "${version}")` };
  if (!name || !goal) return { ok: false, reason: 'addMilestone: name and goal are required' };

  const { content, parsed } = readRoadmap(roadmapPath);
  if (parsed.milestones.some(m => m.id === id)) {
    return { ok: false, reason: `addMilestone: milestone "${id}" already exists` };
  }

  // Append at end of file. Ensure exactly one blank line separates from prior
  // content, and the new block ends with a trailing newline.
  const lines = [...parsed.lines];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const block = [
    '',
    `## Milestone ${id}`,
    '',
    `**Version:** ${version}`,
    `**Name:** ${name}`,
    `**Goal:** ${goal}`,
    '',
  ];
  let newLines = [...lines, ...block];

  // Frontmatter updates.
  const fmUpdates = { updated: today() };
  if (setCurrent) {
    fmUpdates.current_milestone = id;
    fmUpdates.version = version;
  }
  const newFm = rewriteFrontmatter(newLines, parsed.frontmatterLines, fmUpdates);
  newLines = spliceLines(newLines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const newContent = newLines.join('\n');
  const res = writeRoadmapAtomic(roadmapPath, newContent);
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- op: addPhase -------------------------------------------------------

function addPhase({ roadmapPath, milestoneId, id, title, goal }) {
  if (!validateId(id)) return { ok: false, reason: `addPhase: invalid phase id "${id}"` };
  if (!title || !goal) return { ok: false, reason: 'addPhase: title and goal are required' };

  const { parsed } = readRoadmap(roadmapPath);
  const milestone = parsed.milestones.find(m => m.id === milestoneId);
  if (!milestone) return { ok: false, reason: `addPhase: milestone "${milestoneId}" not found` };
  if (milestone.phases.some(p => p.id === id)) {
    return { ok: false, reason: `addPhase: phase "${id}" already exists in milestone "${milestoneId}"` };
  }

  // Insertion point: just before the milestone's range end (which is the
  // line index of the next milestone, or lines.length). Back up past any
  // trailing blank lines so we don't accumulate extra blanks over time.
  let insertAtLine = milestone.range[1];
  while (insertAtLine - 1 > milestone.headingLine && parsed.lines[insertAtLine - 1] === '') {
    insertAtLine--;
  }
  const block = [
    '',
    `### Phase ${id} — ${title}`,
    '',
    goal,
    '',
  ];
  let newLines = insertAt(parsed.lines, insertAtLine, block);

  const newFm = rewriteFrontmatter(newLines, parsed.frontmatterLines, { updated: today() });
  newLines = spliceLines(newLines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const res = writeRoadmapAtomic(roadmapPath, newLines.join('\n'));
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- op: advance --------------------------------------------------------

function advance({ roadmapPath }) {
  const { parsed } = readRoadmap(roadmapPath);
  const currentId = parsed.frontmatter.current_milestone;
  if (!currentId) return { ok: false, reason: 'advance: frontmatter has no current_milestone' };

  const idx = parsed.milestones.findIndex(m => m.id === currentId);
  if (idx === -1) return { ok: false, reason: `advance: current_milestone "${currentId}" has no matching ## Milestone heading` };
  const current = parsed.milestones[idx];
  const next = parsed.milestones[idx + 1];
  if (!next) {
    return { ok: false, reason: `advance: no next milestone after "${currentId}" — add one first with /fsd-roadmap add-milestone` };
  }

  if (current.shippedStatusLine !== null) {
    return { ok: true, written: false, reason: `advance: milestone "${currentId}" already marked shipped — no-op` };
  }

  if (!next.version) {
    return { ok: false, reason: `advance: next milestone "${next.id}" has no **Version:** line` };
  }

  // Insert Status line immediately after the `## Milestone …` heading. The
  // render template puts a blank line after the heading, so we insert at
  // headingLine + 1 and push a blank line after ours for readability.
  const statusLine = `**Status:** shipped (${today()})`;
  let newLines = [...parsed.lines];
  // Preserve the existing blank line after the heading if present.
  if (newLines[current.headingLine + 1] === '') {
    newLines = insertAt(newLines, current.headingLine + 1, [statusLine]);
  } else {
    newLines = insertAt(newLines, current.headingLine + 1, ['', statusLine]);
  }

  // Re-parse to get fresh ranges after the insert — but we only need the
  // frontmatter range which didn't change, so re-use.
  const newFm = rewriteFrontmatter(newLines, parsed.frontmatterLines, {
    current_milestone: next.id,
    version: next.version,
    updated: today(),
  });
  newLines = spliceLines(newLines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const res = writeRoadmapAtomic(roadmapPath, newLines.join('\n'));
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- op: completePhase --------------------------------------------------

function completePhase({ roadmapPath, phaseId }) {
  if (!phaseId) return { ok: false, reason: 'completePhase: phaseId is required' };
  const { parsed } = readRoadmap(roadmapPath);
  let target = null;
  for (const m of parsed.milestones) {
    const p = m.phases.find(ph => ph.id === phaseId);
    if (p) { target = { milestone: m, phase: p }; break; }
  }
  if (!target) return { ok: false, reason: `completePhase: phase "${phaseId}" not found` };
  if (target.phase.shippedStatusLine !== null) {
    return { ok: true, written: false, reason: `completePhase: phase "${phaseId}" already marked shipped — no-op` };
  }

  const statusLine = `**Status:** shipped (${today()})`;
  let newLines = [...parsed.lines];
  const insertIdx = target.phase.headingLine + 1;
  if (newLines[insertIdx] === '') {
    newLines = insertAt(newLines, insertIdx, [statusLine]);
  } else {
    newLines = insertAt(newLines, insertIdx, ['', statusLine]);
  }

  const newFm = rewriteFrontmatter(newLines, parsed.frontmatterLines, { updated: today() });
  newLines = spliceLines(newLines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const res = writeRoadmapAtomic(roadmapPath, newLines.join('\n'));
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- op: bumpVersion ----------------------------------------------------

function bumpVersion({ roadmapPath, newVersion }) {
  if (!newVersion || !SEMVER_LIKE.test(String(newVersion))) {
    return { ok: false, reason: `bumpVersion: "${newVersion}" is not semver-like` };
  }
  const { parsed } = readRoadmap(roadmapPath);
  if (parsed.frontmatter.version === newVersion) {
    return { ok: false, reason: `bumpVersion: version is already "${newVersion}" — no-op` };
  }

  const newFm = rewriteFrontmatter(parsed.lines, parsed.frontmatterLines, {
    version: newVersion,
    updated: today(),
  });
  const newLines = spliceLines(parsed.lines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const res = writeRoadmapAtomic(roadmapPath, newLines.join('\n'));
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- CLI entry point ----------------------------------------------------

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

const OPS = {
  'add-milestone': addMilestone,
  'add-phase': addPhase,
  'advance': advance,
  'complete-phase': completePhase,
  'bump-version': bumpVersion,
};

if (require.main === module) {
  const [, , roadmapPath, opName, ...rest] = process.argv;
  if (!roadmapPath || !opName || !OPS[opName]) {
    process.stderr.write(`usage: roadmap.js <roadmapPath> <${Object.keys(OPS).join('|')}> [--key=value ...]\n`);
    process.exit(2);
  }
  const opArgs = { roadmapPath, ...parseCliArgs(rest) };
  const result = OPS[opName](opArgs);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  parseRoadmap,
  readRoadmap,
  writeRoadmapAtomic,
  rewriteFrontmatter,
  addMilestone,
  addPhase,
  advance,
  completePhase,
  bumpVersion,
  today,
};
