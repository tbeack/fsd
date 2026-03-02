#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require(path.join(__dirname, 'yaml-parser.js'));

/**
 * Load and merge config.yaml from three layers.
 * Shallow merge: project > user > core (later layers override earlier).
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

    // Shallow merge: each key from higher layer replaces entirely
    merged = { ...merged, ...parsed };
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

module.exports = { loadConfig, resolveLayerPaths };
