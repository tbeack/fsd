#!/usr/bin/env node
'use strict';

const VALID_MODELS = ['sonnet', 'opus', 'haiku'];
const VALID_CONTEXT_STRATEGIES = ['fresh', 'shared', 'minimal'];
const PROFILE_REF_PATTERN = /^\$\{profile\.\w+\}$/;

// Artifact (storage-kind) frontmatter primitives.
const ARTIFACT_STATUSES = ['draft', 'active', 'archived'];
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CROSS_REF = /^(spec|plan|research)\/[a-z0-9]+(-[a-z0-9]+)*$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const SEMVER_LIKE = /^\d+\.\d+(\.\d+)?$/;

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

/**
 * Type-tolerant boolean check. The bundled YAML parser returns scalar values
 * as strings, so frontmatter `approved: true` is read as the string "true".
 * Accept either a real boolean or one of the canonical string forms.
 */
function isBooleanish(v) {
  return typeof v === 'boolean' || v === 'true' || v === 'false';
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isStringArrayMatching(v, regex) {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (typeof item !== 'string' || !regex.test(item)) return false;
  }
  return true;
}

/**
 * Common artifact frontmatter validation. Shared by spec/plan/research.
 * Enforces: project (non-empty string), id (kebab-case), title (non-empty),
 * status (enum), created (ISO date), and optional updated/tags/related.
 *
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateArtifactCommon(meta) {
  const errors = [];
  const warnings = [];

  if (!isNonEmptyString(meta.project)) {
    errors.push('project: required, must be a non-empty string');
  }

  if (!isNonEmptyString(meta.id)) {
    errors.push('id: required, must be a non-empty string');
  } else if (!KEBAB_CASE.test(meta.id)) {
    errors.push('id: must be kebab-case (lowercase a-z, 0-9, hyphens)');
  }

  if (!isNonEmptyString(meta.title)) {
    errors.push('title: required, must be a non-empty string');
  }

  if (!meta.status) {
    errors.push(`status: required, must be one of ${ARTIFACT_STATUSES.join(', ')}`);
  } else if (!ARTIFACT_STATUSES.includes(meta.status)) {
    errors.push(`status: must be one of ${ARTIFACT_STATUSES.join(', ')}`);
  }

  if (!meta.created) {
    errors.push('created: required, must be an ISO date (YYYY-MM-DD)');
  } else if (!ISO_DATE.test(meta.created)) {
    errors.push('created: must be an ISO date (YYYY-MM-DD)');
  }

  if (meta.updated !== undefined && !ISO_DATE.test(meta.updated)) {
    errors.push('updated: must be an ISO date (YYYY-MM-DD)');
  }

  if (meta.tags !== undefined && !isStringArrayMatching(meta.tags, KEBAB_CASE)) {
    errors.push('tags: must be an array of kebab-case strings');
  }

  if (meta.related !== undefined && !isStringArrayMatching(meta.related, CROSS_REF)) {
    errors.push('related: must be an array of <spec|plan|research>/<kebab-id> references');
  }

  return { errors, warnings };
}

/**
 * Validate spec artifact frontmatter.
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSpec(meta) {
  const { errors, warnings } = validateArtifactCommon(meta);

  if (meta.approved !== undefined && !isBooleanish(meta.approved)) {
    errors.push('approved: must be a boolean (true|false)');
  }

  if (meta.supersedes !== undefined && !isStringArrayMatching(meta.supersedes, KEBAB_CASE)) {
    errors.push('supersedes: must be an array of kebab-case spec ids');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate plan artifact frontmatter.
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePlan(meta) {
  const { errors, warnings } = validateArtifactCommon(meta);

  if (meta.task !== undefined && !isNonEmptyString(meta.task)) {
    errors.push('task: must be a non-empty string');
  }

  if (meta.depends_on !== undefined && !isStringArrayMatching(meta.depends_on, KEBAB_CASE)) {
    errors.push('depends_on: must be an array of kebab-case plan ids');
  }

  if (meta.estimate !== undefined && !isNonEmptyString(meta.estimate)) {
    errors.push('estimate: must be a non-empty string');
  }

  if (meta.supersedes !== undefined && !isStringArrayMatching(meta.supersedes, KEBAB_CASE)) {
    errors.push('supersedes: must be an array of kebab-case plan ids');
  }

  const verification = validateVerificationField(meta);
  errors.push(...verification.errors);
  warnings.push(...verification.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate research artifact frontmatter.
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateResearch(meta) {
  const { errors, warnings } = validateArtifactCommon(meta);

  if (meta.sources !== undefined && !isStringArrayMatching(meta.sources, URL_PATTERN)) {
    errors.push('sources: must be an array of http(s) URL strings');
  }

  if (meta.conclusion !== undefined && !isNonEmptyString(meta.conclusion)) {
    errors.push('conclusion: must be a non-empty string');
  }

  return { valid: errors.length === 0, errors, warnings };
}

const ARTIFACT_VALIDATORS = {
  spec: validateSpec,
  plan: validatePlan,
  research: validateResearch,
};

const VERIFICATION_SUBFIELDS = ['tests', 'validate', 'typecheck', 'lint'];

/**
 * Validate an optional `verification:` frontmatter object. Shape:
 *   verification:
 *     tests?: string       # command run after each plan phase
 *     validate?: string    # schema validation command
 *     typecheck?: string   # type-check command
 *     lint?: string        # lint command
 *
 * Absent → pass. Present → must be a plain object, each known subfield is a
 * non-empty string when set, unknown subfields surface as warnings (forward-
 * compatible — future commands can ship without breaking older validators).
 *
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateVerificationField(meta) {
  const errors = [];
  const warnings = [];

  if (meta.verification === undefined || meta.verification === null) {
    return { errors, warnings };
  }

  const v = meta.verification;
  if (typeof v !== 'object' || Array.isArray(v)) {
    errors.push('verification: must be a mapping with optional subfields tests|validate|typecheck|lint');
    return { errors, warnings };
  }

  for (const key of Object.keys(v)) {
    if (!VERIFICATION_SUBFIELDS.includes(key)) {
      warnings.push(`verification.${key}: unknown subfield (expected one of ${VERIFICATION_SUBFIELDS.join(', ')})`);
      continue;
    }
    if (!isNonEmptyString(v[key])) {
      errors.push(`verification.${key}: must be a non-empty string when present`);
    }
  }

  return { errors, warnings };
}

/**
 * Common project-context frontmatter validation. Shared by PROJECT.md and
 * ROADMAP.md. Mirrors the artifact schema vocabulary so the two kinds of
 * files feel consistent, but the files themselves live in `planning/` (not
 * `.fsd/`) and are not scanned as artifacts.
 *
 * Enforces: project (non-empty), id (kebab-case), title (non-empty),
 * status (enum), created (ISO date); optional updated/tags.
 *
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateProjectContextCommon(meta) {
  const errors = [];
  const warnings = [];

  if (!isNonEmptyString(meta.project)) {
    errors.push('project: required, must be a non-empty string');
  }

  if (!isNonEmptyString(meta.id)) {
    errors.push('id: required, must be a non-empty string');
  } else if (!KEBAB_CASE.test(meta.id)) {
    errors.push('id: must be kebab-case (lowercase a-z, 0-9, hyphens)');
  }

  if (!isNonEmptyString(meta.title)) {
    errors.push('title: required, must be a non-empty string');
  }

  if (!meta.status) {
    errors.push(`status: required, must be one of ${ARTIFACT_STATUSES.join(', ')}`);
  } else if (!ARTIFACT_STATUSES.includes(meta.status)) {
    errors.push(`status: must be one of ${ARTIFACT_STATUSES.join(', ')}`);
  }

  if (!meta.created) {
    errors.push('created: required, must be an ISO date (YYYY-MM-DD)');
  } else if (!ISO_DATE.test(meta.created)) {
    errors.push('created: must be an ISO date (YYYY-MM-DD)');
  }

  if (meta.updated !== undefined && !ISO_DATE.test(meta.updated)) {
    errors.push('updated: must be an ISO date (YYYY-MM-DD)');
  }

  if (meta.tags !== undefined && !isStringArrayMatching(meta.tags, KEBAB_CASE)) {
    errors.push('tags: must be an array of kebab-case strings');
  }

  return { errors, warnings };
}

/**
 * Validate PROJECT.md frontmatter. Captures project identity, scope, tech
 * context — the one-time kickoff artifact that downstream skills read from.
 *
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateProject(meta) {
  const { errors, warnings } = validateProjectContextCommon(meta);

  if (meta.vision !== undefined && !isNonEmptyString(meta.vision)) {
    errors.push('vision: must be a non-empty string');
  }

  if (meta.target_users !== undefined) {
    if (!Array.isArray(meta.target_users) ||
        meta.target_users.some(u => !isNonEmptyString(u))) {
      errors.push('target_users: must be an array of non-empty strings');
    }
  }

  const verification = validateVerificationField(meta);
  errors.push(...verification.errors);
  warnings.push(...verification.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate ROADMAP.md frontmatter. Versioned milestones → numbered phases.
 * Requires `version` (semver-like) and `current_milestone` in addition to
 * the common project-context fields.
 *
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateRoadmap(meta) {
  const { errors, warnings } = validateProjectContextCommon(meta);

  if (!isNonEmptyString(meta.version)) {
    errors.push('version: required, must be a semver-like string (e.g. "1.0" or "1.0.0")');
  } else if (!SEMVER_LIKE.test(meta.version)) {
    errors.push('version: must be a semver-like string (e.g. "1.0" or "1.0.0")');
  }

  if (!isNonEmptyString(meta.current_milestone)) {
    errors.push('current_milestone: required, must be a non-empty string');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate ARCHITECTURE.md frontmatter. Long-lived project-level artifact
 * capturing stack, ADR-style decisions, code examples, references, standards,
 * glossary, and open architectural questions. No artifact-specific extensions
 * beyond the common project-context fields in v1.
 *
 * @param {Object} meta - Parsed frontmatter
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateArchitecture(meta) {
  const { errors, warnings } = validateProjectContextCommon(meta);
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
  validateSpec,
  validatePlan,
  validateResearch,
  validateProject,
  validateRoadmap,
  validateArchitecture,
  validateVerificationField,
  VERIFICATION_SUBFIELDS,
  ARTIFACT_VALIDATORS,
  ARTIFACT_STATUSES,
  KEBAB_CASE,
  ISO_DATE,
  CROSS_REF,
  URL_PATTERN,
  SEMVER_LIKE,
  STRUCTURE_KEYS,
  SCANNABLE_KINDS,
  STORAGE_KINDS,
  RESERVED_STRUCTURE_VALUES,
};
