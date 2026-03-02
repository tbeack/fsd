#!/usr/bin/env node
'use strict';

/**
 * Minimal YAML parser for FSD config files.
 * Handles: flat key-value pairs, string arrays (- item), comments, blank lines.
 * Does NOT handle: nested objects, multi-line strings, anchors, flow sequences.
 */
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentArrayKey = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Array item: "  - value"
    if (trimmed.startsWith('- ') && currentArrayKey) {
      let value = trimmed.slice(2).trim();
      value = stripQuotes(value);
      result[currentArrayKey].push(value);
      continue;
    }

    // Key-value pair: "key: value" or "key:" (start of array)
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();

    if (rawValue === '' || rawValue === '|' || rawValue === '>') {
      // Start of an array (or block scalar -- we only support arrays)
      currentArrayKey = key;
      result[key] = [];
    } else {
      // Simple key-value
      currentArrayKey = null;
      result[key] = stripQuotes(rawValue);
    }
  }

  return result;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

module.exports = { parseYaml };
