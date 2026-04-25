#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));
const { validateStructure } = require(path.join(__dirname, 'validator.js'));

const DEFAULT_STRUCTURE = Object.freeze({
  // Scannable kinds
  skills: 'skills',
  agents: 'agents',
  commands: 'commands',
  // Storage kinds (artifacts produced by spec / plan / research)
  spec: 'spec',
  plan: 'plan',
  research: 'research',
});

/**
 * Strategic merge of two config objects.
 * - Scalars: last writer wins
 * - Arrays: concatenate with dedup
 * - Objects: recursive merge
 * - Keys ending with !replace: force full replacement (strip suffix)
 */
function strategicMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    // Handle !replace suffix — force full replacement
    if (key.endsWith('!replace')) {
      const realKey = key.slice(0, -8); // strip '!replace'
      result[realKey] = source[key];
      continue;
    }

    const targetVal = result[key];
    const sourceVal = source[key];

    if (!(key in result)) {
      result[key] = sourceVal;
    } else if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      // Concatenate with dedup
      result[key] = [...new Set([...targetVal, ...sourceVal])];
    } else if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
      // Recursive merge
      result[key] = strategicMerge(targetVal, sourceVal);
    } else {
      // Scalar: last writer wins
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Load and merge config.yaml from three layers.
 * Strategic merge: project > user > core.
 *
 * @param {Object} paths
 * @param {string} paths.corePath  - Core plugin directory
 * @param {string} paths.userPath  - User space (~/.fsd/)
 * @param {string} paths.projectPath - Project space (.fsd/)
 * @returns {Object} Merged config
 */
function loadConfig({ corePath, userPath, projectPath }) {
  const layers = [corePath, userPath, projectPath];
  let merged = {};

  for (const layerPath of layers) {
    const configFile = path.join(layerPath, 'config.yaml');
    if (!fs.existsSync(configFile)) continue;

    const content = fs.readFileSync(configFile, 'utf-8');
    const parsed = parseYaml(content);

    merged = strategicMerge(merged, parsed);
  }

  return merged;
}

/**
 * Resolve the standard three-layer paths.
 *
 * @param {string} [pluginRoot] - Override for CLAUDE_PLUGIN_ROOT
 * @returns {Object} { corePath, userPath, projectPath }
 */
function resolveLayerPaths(pluginRoot) {
  const corePath = pluginRoot || process.env.CLAUDE_PLUGIN_ROOT || __dirname;
  const userPath = path.join(process.env.HOME || '~', '.fsd');
  const projectPath = path.join(process.cwd(), '.fsd');
  return { corePath, userPath, projectPath };
}

/**
 * Resolve the effective content-kind → directory mapping.
 *
 * `structure:` in config is a partial override — any subset of the known kinds
 * may be specified; missing kinds fall back to `DEFAULT_STRUCTURE`. Malformed
 * entries are dropped with a warning (not thrown) so a broken structure: key
 * can never lock the user out of their own content.
 *
 * @param {Object} [config] - Merged config (may contain .structure)
 * @returns {{ skills: string, agents: string, commands: string }}
 */
function getStructure(config) {
  const override = (config && config.structure) || {};
  const { valid, errors } = validateStructure(override);

  if (!valid) {
    for (const err of errors) {
      process.stderr.write(`[fsd] config.structure: ${err} — using default\n`);
    }
    return { ...DEFAULT_STRUCTURE };
  }

  return { ...DEFAULT_STRUCTURE, ...override };
}

module.exports = { loadConfig, resolveLayerPaths, strategicMerge, getStructure, DEFAULT_STRUCTURE };
