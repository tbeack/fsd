#!/usr/bin/env node
'use strict';

/**
 * ARCHITECTURE.md authoring + maintenance module (FSD-008).
 *
 * Pairs with the `/fsd:plan` skill. ARCHITECTURE.md is a long-lived,
 * project-level artifact that captures stack, ADR-style decisions, code
 * examples, references, standards, glossary, and open architectural
 * questions. It lives at `<planningDir>/ARCHITECTURE.md` alongside
 * PROJECT.md and ROADMAP.md.
 *
 * Responsibilities split across the exported functions:
 *
 *   createArchitectureFile  — one-shot create, refuses to overwrite
 *   appendDecision          — ADR-style entry prepended under ## Decisions
 *   appendToSection         — append-to-end for the six non-ADR sections
 *
 * Parser is line-range-aware (mirrors roadmap.js / spec-update.js) so each
 * append op splices the file directly rather than re-rendering. Every op
 * bumps frontmatter `updated:` to today and re-validates via
 * validateArchitecture before touching disk. Atomic write via tmp+rename.
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validateArchitecture } = require(path.join(__dirname, 'validator.js'));
const { loadProjectContext } = require(path.join(__dirname, 'loader.js'));

const ARCHITECTURE_FILENAME = 'ARCHITECTURE.md';

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Canonical section order + metadata. Keys are stable identifiers callers
// pass in architectureData.sections[id] and in appendToSection({sectionId}).
const SECTION_ORDER = ['stack', 'decisions', 'code_examples', 'references', 'standards', 'glossary', 'open_questions'];
const SECTION_META = {
  stack:          { heading: 'Stack & Technical Details',     placeholder: '_Core stack, runtime versions, hosting, and cross-cutting technical facts._' },
  decisions:      { heading: 'Decisions',                      placeholder: '_Architecture Decision Records — newest first._' },
  code_examples:  { heading: 'Code Examples',                  placeholder: '_Canonical idioms, snippets, and patterns the team follows._' },
  references:     { heading: 'References',                     placeholder: '_External docs, specs, papers, prior art._' },
  standards:      { heading: 'Standards',                      placeholder: '_Naming, error handling, testing discipline, code style._' },
  glossary:       { heading: 'Glossary',                       placeholder: '_Project-specific vocabulary — definitions for load-bearing terms._' },
  open_questions: { heading: 'Open architectural questions',   placeholder: '_Unresolved cross-cutting issues surfacing across plans._' },
};

// Reverse lookup: heading text -> canonical id. Unknown headings stay null.
const HEADING_TO_ID = Object.fromEntries(
  SECTION_ORDER.map(id => [SECTION_META[id].heading, id])
);

// ---- serialization ------------------------------------------------------

function yamlLine(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
  }
  return `${key}: ${value}`;
}

/**
 * Build an ARCHITECTURE.md file's full content (frontmatter + 7 body sections).
 *
 * @param {Object} data
 * @param {string}   data.project       - Human-readable project name
 * @param {string}  [data.id]           - kebab-case id; defaults to 'architecture'
 * @param {string}   data.title         - human-readable title
 * @param {string}  [data.status]       - draft|active|archived (default 'active')
 * @param {string}  [data.created]      - ISO date (default today)
 * @param {string}  [data.updated]      - ISO date
 * @param {string[]}[data.tags]         - kebab-case tags
 * @param {Object}  [data.sections]     - keyed body content; missing keys fall back to placeholders
 * @returns {string}
 */
function renderArchitecture(data) {
  const meta = {
    project: data.project,
    id: data.id || 'architecture',
    title: data.title,
    status: data.status || 'active',
    created: data.created || today(),
  };
  if (data.updated) meta.updated = data.updated;
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

// ---- parser -------------------------------------------------------------

/**
 * Parse an ARCHITECTURE.md into a structured view with line ranges for each
 * H2 section so append ops can splice without re-rendering. Tolerates unknown
 * H2 headings (captured with id: null) so engineer-authored extras don't trip
 * the parser.
 *
 * @param {string} content
 * @returns {{
 *   lines: string[],
 *   frontmatter: Object,
 *   frontmatterLines: [number, number],
 *   bodyStart: number,
 *   sections: Array<{ id: string|null, heading: string, headingLine: number, range: [number, number] }>,
 * }}
 */
function parseArchitecture(content) {
  const lines = content.split('\n');

  if (lines[0] !== '---') {
    throw new Error('parseArchitecture: file does not begin with `---` frontmatter delimiter');
  }
  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { frontmatterEnd = i; break; }
  }
  if (frontmatterEnd === -1) {
    throw new Error('parseArchitecture: unterminated frontmatter block (no closing `---`)');
  }
  const frontmatterText = lines.slice(1, frontmatterEnd).join('\n');
  const frontmatter = parseYaml(frontmatterText);
  const bodyStart = frontmatterEnd + 1;

  const sectionLines = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(/^## (.+)\s*$/);
    if (m) {
      const heading = m[1].trim();
      sectionLines.push({ line: i, heading, id: HEADING_TO_ID[heading] || null });
    }
  }

  const sections = sectionLines.map((s, idx) => {
    const end = idx + 1 < sectionLines.length ? sectionLines[idx + 1].line : lines.length;
    return {
      id: s.id,
      heading: s.heading,
      headingLine: s.line,
      range: [s.line, end],
    };
  });

  return {
    lines,
    frontmatter,
    frontmatterLines: [0, frontmatterEnd],
    bodyStart,
    sections,
  };
}

// ---- frontmatter editing ------------------------------------------------

/**
 * Produce a new frontmatter block (including `---` fences) by applying
 * `updates` to the existing frontmatter text. Preserves key order for keys
 * already present; appends new keys before the closing fence. Set an update
 * value to `null` to delete the key.
 */
function rewriteFrontmatter(originalLines, frontmatterRange, updates) {
  const [start, end] = frontmatterRange;
  const out = [originalLines[start]];
  const seen = new Set();

  for (let i = start + 1; i < end; i++) {
    const line = originalLines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
    if (!m) { out.push(line); continue; }
    const key = m[1];
    if (!(key in updates)) { out.push(line); continue; }
    seen.add(key);
    if (updates[key] === null) continue;
    out.push(`${key}: ${updates[key]}`);
  }
  for (const key of Object.keys(updates)) {
    if (seen.has(key) || updates[key] === null) continue;
    out.push(`${key}: ${updates[key]}`);
  }
  out.push(originalLines[end]);
  return out;
}

function spliceLines(lines, range, replacement) {
  return [...lines.slice(0, range[0]), ...replacement, ...lines.slice(range[1])];
}

// ---- section-body helpers -----------------------------------------------

/**
 * Extract the body lines of a section (between its heading and the next
 * section / EOF), trimming trailing blank lines.
 */
function sectionBody(parsed, section) {
  const [, end] = section.range;
  const body = parsed.lines.slice(section.headingLine + 1, end);
  while (body.length && body[body.length - 1] === '') body.pop();
  while (body.length && body[0] === '') body.shift();
  return body;
}

/**
 * True iff the section body is still the canonical italic placeholder (or
 * empty), i.e. has no engineer-authored content yet.
 */
function isPlaceholder(parsed, section) {
  if (!section.id) return false;
  const expected = SECTION_META[section.id].placeholder;
  const body = sectionBody(parsed, section);
  if (body.length === 0) return true;
  if (body.length === 1 && body[0] === expected) return true;
  return false;
}

// ---- atomic write -------------------------------------------------------

function writeArchitectureAtomic(architecturePath, newContent) {
  let parsed;
  try {
    parsed = parseArchitecture(newContent);
  } catch (e) {
    return { ok: false, reason: `parse failed on new content: ${e.message}` };
  }
  const validation = validateArchitecture(parsed.frontmatter);
  if (!validation.valid) {
    return { ok: false, reason: `validateArchitecture rejected the result: ${validation.errors.join('; ')}` };
  }
  const tmp = `${architecturePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, newContent);
  fs.renameSync(tmp, architecturePath);
  return { ok: true };
}

// ---- op: createArchitectureFile -----------------------------------------

/**
 * Create `<planningDir>/ARCHITECTURE.md`. Refuses to overwrite an existing
 * file. Pre-validates via `validateArchitecture` BEFORE touching disk.
 * Auto-injects `project:` from the sibling PROJECT.md when the caller didn't
 * supply it directly.
 *
 * @param {Object} opts
 * @param {string}  opts.planningDir         - Directory to create ARCHITECTURE.md in
 * @param {Object}  opts.architectureData    - Fields for renderArchitecture
 * @returns {{ ok: boolean, written?: string[], skipped?: string[], reason?: string }}
 */
function createArchitectureFile({ planningDir, architectureData }) {
  if (!planningDir) {
    return { ok: false, written: [], skipped: [], reason: 'createArchitectureFile: planningDir is required' };
  }
  if (!architectureData || typeof architectureData !== 'object') {
    return { ok: false, written: [], skipped: [], reason: 'createArchitectureFile: architectureData is required' };
  }

  const data = { ...architectureData };

  // Auto-inject project from PROJECT.md when absent.
  if (!data.project) {
    const ctx = loadProjectContext({ planningDir });
    if (!ctx.project) {
      return {
        ok: false,
        written: [],
        skipped: [],
        reason: `PROJECT.md not found under ${planningDir} — run /fsd:new-project first or pass architectureData.project explicitly`,
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

  if (!data.title) {
    data.title = `${data.project} Architecture`;
  }

  const targetPath = path.join(planningDir, ARCHITECTURE_FILENAME);

  if (fs.existsSync(targetPath)) {
    return {
      ok: false,
      written: [],
      skipped: [targetPath],
      reason: `refusing to overwrite existing file: ${targetPath}`,
    };
  }

  // Build the meta the renderer will emit, validate BEFORE writing.
  const metaForValidation = {
    project: data.project,
    id: data.id || 'architecture',
    title: data.title,
    status: data.status || 'active',
    created: data.created || today(),
  };
  if (data.updated) metaForValidation.updated = data.updated;
  if (Array.isArray(data.tags) && data.tags.length) metaForValidation.tags = data.tags;

  const validation = validateArchitecture(metaForValidation);
  if (!validation.valid) {
    return {
      ok: false,
      written: [],
      skipped: [],
      reason: `invalid frontmatter: ${validation.errors.join('; ')}`,
    };
  }

  fs.mkdirSync(planningDir, { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, renderArchitecture(data));
  fs.renameSync(tmp, targetPath);

  return { ok: true, written: [targetPath], skipped: [] };
}

// ---- op: appendDecision --------------------------------------------------

/**
 * Prepend a new ADR-style entry at the top of `## Decisions`. Entry shape:
 *
 *   ### YYYY-MM-DD — <title>
 *
 *   **Context:** <context>
 *
 *   **Decision:** <decision>
 *
 *   **Consequences:** <consequences>
 *
 * Refuses if ARCHITECTURE.md is missing (creation is createArchitectureFile's
 * job). Bumps frontmatter `updated:` to today. Strips the section's italic
 * placeholder if this is the first real entry.
 */
function appendDecision({ planningDir, title, context, decision, consequences, date }) {
  if (!planningDir) return { ok: false, reason: 'appendDecision: planningDir is required' };
  if (!title || !context || !decision || !consequences) {
    return { ok: false, reason: 'appendDecision: title, context, decision, consequences are all required' };
  }

  const targetPath = path.join(planningDir, ARCHITECTURE_FILENAME);
  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: `appendDecision: ARCHITECTURE.md not found at ${targetPath}` };
  }

  const content = fs.readFileSync(targetPath, 'utf-8');
  const parsed = parseArchitecture(content);
  const section = parsed.sections.find(s => s.id === 'decisions');
  if (!section) {
    return { ok: false, reason: 'appendDecision: ## Decisions section not found' };
  }

  const entryDate = date || today();
  // Entry lines WITHOUT a trailing '' — blank-line separation is provided by
  // the context-specific splice below. Keeping the entry's last element as
  // the content line simplifies blank-line accounting.
  const entry = [
    `### ${entryDate} — ${title}`,
    '',
    `**Context:** ${context}`,
    '',
    `**Decision:** ${decision}`,
    '',
    `**Consequences:** ${consequences}`,
  ];

  let newLines = [...parsed.lines];
  const headingLine = section.headingLine;
  // Body conventionally starts at headingLine + 2 (heading + blank).
  let insertAt = headingLine + 1;
  if (newLines[insertAt] === '') insertAt++;

  if (isPlaceholder(parsed, section)) {
    // Replace the single placeholder line with the entry. The existing blank
    // line before the next section heading stays, giving one blank separator.
    let bodyEnd = insertAt;
    while (bodyEnd < section.range[1] && newLines[bodyEnd] !== '') bodyEnd++;
    newLines = spliceLines(newLines, [insertAt, bodyEnd], entry);
  } else {
    // Prepend the entry at the top so the newest ADR is first. Insert the
    // entry + one blank separator; the existing first entry follows.
    newLines = spliceLines(newLines, [insertAt, insertAt], [...entry, '']);
  }

  const newFm = rewriteFrontmatter(newLines, parsed.frontmatterLines, { updated: today() });
  newLines = spliceLines(newLines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const res = writeArchitectureAtomic(targetPath, newLines.join('\n'));
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- op: appendToSection -------------------------------------------------

/**
 * Append `content` at the end of the named section. If the section is still
 * in its default italic-placeholder state, the placeholder is stripped and
 * replaced by `content`. Refuses unknown section ids or if ARCHITECTURE.md
 * is missing. Does not handle `decisions` (use appendDecision for ADRs).
 */
function appendToSection({ planningDir, sectionId, content }) {
  if (!planningDir) return { ok: false, reason: 'appendToSection: planningDir is required' };
  if (!sectionId || !SECTION_META[sectionId]) {
    return { ok: false, reason: `appendToSection: unknown section id "${sectionId}" (expected one of ${SECTION_ORDER.join(', ')})` };
  }
  if (sectionId === 'decisions') {
    return { ok: false, reason: 'appendToSection: use appendDecision for ADR-style entries under ## Decisions' };
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, reason: 'appendToSection: content must be a non-empty string' };
  }

  const targetPath = path.join(planningDir, ARCHITECTURE_FILENAME);
  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: `appendToSection: ARCHITECTURE.md not found at ${targetPath}` };
  }

  const raw = fs.readFileSync(targetPath, 'utf-8');
  const parsed = parseArchitecture(raw);
  const section = parsed.sections.find(s => s.id === sectionId);
  if (!section) {
    return { ok: false, reason: `appendToSection: section "${SECTION_META[sectionId].heading}" not found` };
  }

  let newLines = [...parsed.lines];

  if (isPlaceholder(parsed, section)) {
    // Replace the single placeholder line with new content. The existing
    // blank line before the next section stays as the trailing separator.
    let insertAt = section.headingLine + 1;
    if (newLines[insertAt] === '') insertAt++;
    let bodyEnd = insertAt;
    while (bodyEnd < section.range[1] && newLines[bodyEnd] !== '') bodyEnd++;
    newLines = spliceLines(newLines, [insertAt, bodyEnd], [content.trim()]);
  } else {
    // Append at the end of the section body. Replace the trailing-blank span
    // (1 line, by render convention) with blank + content + blank so we end
    // up with exactly one blank before the next heading and no accumulation.
    const end = section.range[1];
    let endOfContent = end;
    while (endOfContent - 1 > section.headingLine && newLines[endOfContent - 1] === '') endOfContent--;
    newLines = spliceLines(newLines, [endOfContent, end], ['', content.trim(), '']);
  }

  const newFm = rewriteFrontmatter(newLines, parsed.frontmatterLines, { updated: today() });
  newLines = spliceLines(newLines, [parsed.frontmatterLines[0], parsed.frontmatterLines[1] + 1], newFm);

  const res = writeArchitectureAtomic(targetPath, newLines.join('\n'));
  if (!res.ok) return res;
  return { ok: true, written: true };
}

// ---- CLI entry -----------------------------------------------------------

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
  'create': (args) => {
    let architectureData;
    if (args.json) {
      try { architectureData = JSON.parse(fs.readFileSync(args.json, 'utf-8')); }
      catch (e) { return { ok: false, reason: `failed to read --json payload: ${e.message}` }; }
    } else {
      architectureData = {
        project: args.project,
        title: args.title,
        status: args.status,
      };
      if (args.id) architectureData.id = args.id;
    }
    return createArchitectureFile({ planningDir: args.planningDir, architectureData });
  },
  'append-decision': (args) => {
    return appendDecision({
      planningDir: args.planningDir,
      title: args.title,
      context: args.context,
      decision: args.decision,
      consequences: args.consequences,
      date: args.date,
    });
  },
  'append-to-section': (args) => {
    return appendToSection({
      planningDir: args.planningDir,
      sectionId: args.sectionId,
      content: args.content,
    });
  },
};

if (require.main === module) {
  const [, , planningDir, opName, ...rest] = process.argv;
  if (!planningDir || !opName || !OPS[opName]) {
    process.stderr.write(`usage: architecture.js <planningDir> <${Object.keys(OPS).join('|')}> [--key=value ...]\n`);
    process.exit(2);
  }
  const args = { planningDir, ...parseCliArgs(rest) };
  const result = OPS[opName](args);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  parseArchitecture,
  renderArchitecture,
  createArchitectureFile,
  appendDecision,
  appendToSection,
  rewriteFrontmatter,
  today,
  ARCHITECTURE_FILENAME,
  SECTION_ORDER,
  SECTION_META,
  HEADING_TO_ID,
};
