#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { getStructure, DEFAULT_STRUCTURE } = require(path.join(__dirname, 'config.js'));
const { validateStructure, STRUCTURE_KEYS } = require(path.join(__dirname, 'validator.js'));

/**
 * Load a project's .fsd/config.yaml (if present) and return the parsed config
 * along with the raw file content. Never throws — a missing file returns an
 * empty config.
 */
function loadProjectConfig(projectPath) {
  const configFile = path.join(projectPath, '.fsd', 'config.yaml');
  if (!fs.existsSync(configFile)) {
    return { config: {}, rawContent: '', configFile };
  }
  const rawContent = fs.readFileSync(configFile, 'utf-8');
  const config = parseYaml(rawContent);
  return { config, rawContent, configFile };
}

/**
 * Walk .fsd/ looking for markdown files whose body mentions `oldDir` literally.
 * Used to flag (not rewrite) stale references after a rename.
 *
 * @returns {Array<{path: string, matches: Array<{line: number, text: string}>}>}
 */
function findStaleReferences(fsdDir, oldDirNames) {
  if (!fs.existsSync(fsdDir) || oldDirNames.length === 0) return [];

  const results = [];
  const stack = [fsdDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.md')) continue;

      const body = fs.readFileSync(p, 'utf-8');
      const lines = body.split('\n');
      const hits = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const oldDir of oldDirNames) {
          // Match `oldDir/` or `/oldDir/` bounded; avoid matching substrings inside unrelated words.
          const re = new RegExp(`(^|[\\s/\`"'])${oldDir}/`);
          if (re.test(line)) {
            hits.push({ line: i + 1, text: line.trim() });
            break;
          }
        }
      }
      if (hits.length > 0) {
        results.push({ path: p, matches: hits });
      }
    }
  }
  return results;
}

/**
 * Compute the effects of a proposed set of renames without changing disk state.
 *
 * @param {Object} opts
 * @param {string} opts.projectPath - Directory containing .fsd/
 * @param {Object} opts.renames - { kind: newName } (e.g., { skills: 'capabilities' })
 * @returns {{
 *   ok: boolean,
 *   errors: string[],
 *   currentStructure: Object,
 *   proposedStructure: Object,
 *   renameOps: Array<{kind: string, from: string, to: string, physicalRename: boolean}>,
 *   staleReferences: Array,
 *   uncommittedWarning: string|null,
 * }}
 */
function previewRestructure({ projectPath, renames }) {
  const errors = [];
  const { config } = loadProjectConfig(projectPath);
  const fsdDir = path.join(projectPath, '.fsd');
  const currentStructure = getStructure(config);

  // Validate rename keys and build proposed structure
  const proposedStructure = { ...currentStructure };
  for (const kind of Object.keys(renames || {})) {
    if (!STRUCTURE_KEYS.includes(kind)) {
      errors.push(`Unknown content kind "${kind}" (expected one of ${STRUCTURE_KEYS.join(', ')})`);
      continue;
    }
    proposedStructure[kind] = renames[kind];
  }

  // Validate proposed structure as a whole (catches aliases, reserved names, etc.)
  const structureCheck = validateStructure(
    Object.fromEntries(
      Object.entries(proposedStructure).filter(([k, v]) => v !== DEFAULT_STRUCTURE[k])
    ),
  );
  if (!structureCheck.valid) {
    errors.push(...structureCheck.errors);
  }

  // Also cross-check: target dir must not already exist on disk
  for (const kind of Object.keys(renames || {})) {
    if (errors.length > 0) break; // don't double-report on already-invalid renames
    const newName = proposedStructure[kind];
    if (newName === currentStructure[kind]) continue;
    const targetPath = path.join(fsdDir, newName);
    if (fs.existsSync(targetPath)) {
      errors.push(`Cannot rename ${kind} to "${newName}": ${targetPath} already exists`);
    }
  }

  // Build rename ops
  const renameOps = [];
  for (const kind of STRUCTURE_KEYS) {
    if (proposedStructure[kind] === currentStructure[kind]) continue;
    const from = currentStructure[kind];
    const to = proposedStructure[kind];
    const physicalRename = fs.existsSync(path.join(fsdDir, from));
    renameOps.push({ kind, from, to, physicalRename });
  }

  // Flag stale references in content
  const oldNames = renameOps.map(op => op.from);
  const staleReferences = findStaleReferences(fsdDir, oldNames);

  // Uncommitted-changes warning (best-effort; no hard failure from here — skill enforces)
  const uncommittedWarning = null;

  return {
    ok: errors.length === 0,
    errors,
    currentStructure,
    proposedStructure,
    renameOps,
    staleReferences,
    uncommittedWarning,
  };
}

/**
 * Rewrite the config.yaml to set `structure:` to the proposed values.
 * Preserves surrounding content; surgical replacement of the structure: block.
 * If no structure: block exists, append one.
 */
function rewriteConfigStructure(rawContent, proposedStructure) {
  const structureLines = [];
  structureLines.push('# Content-kind → directory mapping (managed by /fsd-restructure)');
  structureLines.push('structure:');
  for (const kind of STRUCTURE_KEYS) {
    if (proposedStructure[kind] === DEFAULT_STRUCTURE[kind]) continue;
    structureLines.push(`  ${kind}: ${proposedStructure[kind]}`);
  }
  // If nothing to record (all defaults), emit a commented-out example
  if (structureLines.length === 2) {
    structureLines.push('  # skills: skills');
    structureLines.push('  # agents: agents');
    structureLines.push('  # commands: commands');
  }
  const newBlock = structureLines.join('\n') + '\n';

  // Look for an existing `structure:` block — from the line starting with
  // `structure:` up to the next top-level key (a line that starts with a
  // non-space non-# character) or end-of-file.
  const structureRegex = /(^|\n)(#[^\n]*\n)*structure:[^\n]*\n(?:(?:[ \t]+[^\n]*|\s*#[^\n]*|\s*)\n?)*/m;

  if (structureRegex.test(rawContent)) {
    return rawContent.replace(structureRegex, (match, leading) => {
      const prefix = leading === '\n' ? '\n' : '';
      return prefix + newBlock;
    });
  }

  // No existing block — append. Ensure trailing newline before append.
  const sep = rawContent.endsWith('\n') ? '' : '\n';
  return rawContent + sep + '\n' + newBlock;
}

/**
 * Apply the rename operations: physical directory renames + config.yaml rewrite.
 * Should only be called after `previewRestructure` returns `ok: true`.
 */
function applyRestructure({ projectPath, renames }) {
  const preview = previewRestructure({ projectPath, renames });
  if (!preview.ok) {
    return { success: false, errors: preview.errors, preview };
  }

  const fsdDir = path.join(projectPath, '.fsd');
  const { rawContent, configFile } = loadProjectConfig(projectPath);

  const applied = [];
  try {
    for (const op of preview.renameOps) {
      if (!op.physicalRename) continue;
      const from = path.join(fsdDir, op.from);
      const to = path.join(fsdDir, op.to);
      fs.renameSync(from, to);
      applied.push({ from, to });
    }
  } catch (err) {
    // Best-effort rollback
    for (const r of applied.reverse()) {
      try { fs.renameSync(r.to, r.from); } catch {}
    }
    return { success: false, errors: [`rename failed: ${err.message}`], preview };
  }

  // Rewrite config.yaml (or create one if it was absent)
  const newContent = rewriteConfigStructure(
    rawContent || '# FSD Project Configuration\n',
    preview.proposedStructure,
  );
  if (!fs.existsSync(path.dirname(configFile))) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
  }
  fs.writeFileSync(configFile, newContent);

  return { success: true, preview, configFile };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: restructure.js <project-dir> [--apply] [kind=newname ...]');
    console.error('  kinds: ' + STRUCTURE_KEYS.join(', '));
    process.exit(2);
  }
  const projectPath = args[0];
  const apply = args.includes('--apply');
  const renames = {};
  for (const a of args.slice(1)) {
    if (a === '--apply') continue;
    const m = a.match(/^([a-z]+)=(.+)$/);
    if (!m) {
      console.error(`Invalid rename spec "${a}". Expected kind=newname.`);
      process.exit(2);
    }
    renames[m[1]] = m[2];
  }

  const result = apply
    ? applyRestructure({ projectPath, renames })
    : previewRestructure({ projectPath, renames });

  if (apply) {
    if (result.success) {
      console.log(`Restructure applied. Renames: ${result.preview.renameOps.map(o => `${o.from}→${o.to}`).join(', ') || '(none)'}`);
      process.exit(0);
    }
    console.error('Restructure failed:');
    for (const e of result.errors) console.error('  - ' + e);
    process.exit(1);
  }

  // Preview
  console.log('Current structure:', JSON.stringify(result.currentStructure));
  console.log('Proposed structure:', JSON.stringify(result.proposedStructure));
  if (result.renameOps.length === 0) {
    console.log('No renames.');
  } else {
    console.log('Rename ops:');
    for (const op of result.renameOps) {
      console.log(`  ${op.kind}: ${op.from} → ${op.to}${op.physicalRename ? '' : ' (dir not present — config-only)'}`);
    }
  }
  if (result.staleReferences.length > 0) {
    console.log(`Stale references flagged (${result.staleReferences.length} file(s)):`);
    for (const ref of result.staleReferences) {
      console.log(`  ${ref.path}:`);
      for (const m of ref.matches) console.log(`    line ${m.line}: ${m.text}`);
    }
  }
  if (result.errors.length > 0) {
    console.error('Errors:');
    for (const e of result.errors) console.error('  - ' + e);
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  previewRestructure,
  applyRestructure,
  rewriteConfigStructure,
  findStaleReferences,
  loadProjectConfig,
};
