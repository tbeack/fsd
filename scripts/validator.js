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

module.exports = { validateSkill, validateAgent, validateCommand };
