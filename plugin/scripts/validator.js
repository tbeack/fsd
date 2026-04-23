#!/usr/bin/env node
'use strict';

const VALID_MODELS = ['sonnet', 'opus', 'haiku'];
const VALID_CONTEXT_STRATEGIES = ['fresh', 'shared', 'minimal'];
const PROFILE_REF_PATTERN = /^\$\{profile\.\w+\}$/;

/**
 * Validate skill frontmatter against schema.
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSkill(meta) {
  const errors = [];
  const warnings = [];

  if (!meta.name || typeof meta.name !== 'string') {
    errors.push('name: required, must be a non-empty string');
  }

  if (!meta.description || typeof meta.description !== 'string') {
    errors.push('description: required, must be a non-empty string');
  } else if (meta.description.length < 20) {
    errors.push('description: must be >= 20 characters');
  }

  if (meta.context_strategy && !VALID_CONTEXT_STRATEGIES.includes(meta.context_strategy)) {
    warnings.push(`context_strategy: must be one of ${VALID_CONTEXT_STRATEGIES.join(', ')}`);
  }

  if (meta.max_context_pct !== undefined) {
    const pct = Number(meta.max_context_pct);
    if (isNaN(pct) || pct < 1 || pct > 100) {
      warnings.push('max_context_pct: must be a number between 1 and 100');
    }
  }

  if (meta.delegates_to !== undefined && !Array.isArray(meta.delegates_to)) {
    warnings.push('delegates_to: must be an array of agent names');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate agent frontmatter against schema.
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateAgent(meta) {
  const errors = [];
  const warnings = [];

  if (!meta.name || typeof meta.name !== 'string') {
    errors.push('name: required, must be a non-empty string');
  }

  if (!meta.description || typeof meta.description !== 'string') {
    errors.push('description: required, must be a non-empty string');
  }

  if (!meta.model || typeof meta.model !== 'string') {
    errors.push('model: required, must be a valid model name or ${profile.*} reference');
  } else if (!VALID_MODELS.includes(meta.model) && !PROFILE_REF_PATTERN.test(meta.model)) {
    errors.push(`model: must be one of ${VALID_MODELS.join(', ')} or a \${profile.*} reference`);
  }

  if (!meta.tools || !Array.isArray(meta.tools) || meta.tools.length === 0) {
    errors.push('tools: required, must be a non-empty array of tool names');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate command frontmatter against schema.
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateCommand(meta) {
  const errors = [];
  const warnings = [];

  if (!meta.name || typeof meta.name !== 'string') {
    errors.push('name: required, must be a non-empty string');
  } else if (!meta.name.startsWith('fsd:')) {
    warnings.push('name: recommended to start with fsd: prefix');
  }

  if (!meta.description || typeof meta.description !== 'string') {
    errors.push('description: required, must be a non-empty string');
  }

  return { valid: errors.length === 0, errors, warnings };
}

const RESERVED_STRUCTURE_VALUES = new Set(['config.yaml', '.state.yaml']);

// Scannable kinds: loaded and activated by the framework at session start.
// Each item is a discrete addressable entity (one SKILL.md per skill dir, one
// .md per agent/command).
const SCANNABLE_KINDS = ['skills', 'agents', 'commands'];

// Storage kinds: directories that hold artifacts produced by skills (specs,
// plans, research notes). The loader does NOT scan these; authoring is owned
// by the corresponding fsd-spec / fsd-plan / fsd-research skills.
const STORAGE_KINDS = ['spec', 'plan', 'research'];

// All known kinds. Accepted by `structure:` config; used by /fsd-restructure.
const STRUCTURE_KEYS = [...SCANNABLE_KINDS, ...STORAGE_KINDS];

/**
 * Validate the `structure:` section of a config.
 * `structure:` is a partial override map: any subset of the known kinds may be
 * present; missing kinds fall back to defaults at resolution time.
 *
 * @param {Object|undefined} structure - The config.structure value, or undefined
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStructure(structure) {
  const errors = [];

  if (structure === undefined || structure === null) {
    return { valid: true, errors };
  }

  if (typeof structure !== 'object' || Array.isArray(structure)) {
    errors.push('structure: must be a mapping');
    return { valid: false, errors };
  }

  const seenValues = new Map();

  for (const key of Object.keys(structure)) {
    if (!STRUCTURE_KEYS.includes(key)) {
      errors.push(`structure.${key}: unknown content kind (expected one of ${STRUCTURE_KEYS.join(', ')})`);
      continue;
    }

    const value = structure[key];

    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`structure.${key}: must be a non-empty string`);
      continue;
    }
    if (value.includes('/') || value.includes('\\')) {
      errors.push(`structure.${key}: must be a single path segment (no slashes), got "${value}"`);
      continue;
    }
    if (value.startsWith('.')) {
      errors.push(`structure.${key}: must not start with "." (got "${value}")`);
      continue;
    }
    if (RESERVED_STRUCTURE_VALUES.has(value)) {
      errors.push(`structure.${key}: "${value}" is a reserved name`);
      continue;
    }
    if (seenValues.has(value)) {
      errors.push(`structure.${key}: "${value}" conflicts with structure.${seenValues.get(value)} (two kinds cannot share the same directory)`);
      continue;
    }
    seenValues.set(value, key);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateSkill,
  validateAgent,
  validateCommand,
  validateStructure,
  STRUCTURE_KEYS,
  SCANNABLE_KINDS,
  STORAGE_KINDS,
  RESERVED_STRUCTURE_VALUES,
};
