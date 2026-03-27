#!/usr/bin/env node
'use strict';

/**
 * Minimal YAML parser for FSD config files.
 * Handles: flat key-value pairs, string arrays (- item), one-level nested objects,
 *          multi-line text blocks (|), inline flow arrays ([a, b]), comments, blank lines.
 * Does NOT handle: deep nesting (2+ levels), anchors, flow objects, multi-line block scalars (>).
 */
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentKey = null;
  let currentMode = null; // null, 'array', 'object', or 'text'

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    // In text block mode (|), collect all indented lines
    if (currentMode === 'text' && currentKey) {
      if (indent >= 2 && trimmed) {
        result[currentKey] += (result[currentKey] ? '\n' : '') + trimmed;
        continue;
      } else if (!trimmed) {
        // Blank line in text block — include it
        if (result[currentKey]) result[currentKey] += '\n';
        continue;
      } else {
        // Non-indented non-empty line — end of text block, fall through
        currentMode = null;
        currentKey = null;
      }
    }

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Indented line — belongs to currentKey
    if (indent >= 2 && currentKey) {
      if (trimmed.startsWith('- ') && (currentMode === 'array' || currentMode === null)) {
        // Array item
        if (currentMode === null) {
          result[currentKey] = [];
          currentMode = 'array';
        }
        let value = trimmed.slice(2).trim();
        result[currentKey].push(stripQuotes(value));
      } else if (currentMode === 'object' || currentMode === null) {
        // Nested key-value
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
          if (currentMode === null) {
            result[currentKey] = {};
            currentMode = 'object';
          }
          const nestedKey = trimmed.slice(0, colonIndex).trim();
          const nestedValue = trimmed.slice(colonIndex + 1).trim();
          if (nestedValue !== '') {
            result[currentKey][nestedKey] = stripQuotes(nestedValue);
          }
        }
      }
      continue;
    }

    // Non-indented line — top-level key
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();

    if (rawValue === '|') {
      // Multi-line text block
      currentKey = key;
      currentMode = 'text';
      result[key] = '';
    } else if (rawValue === '' || rawValue === '>') {
      // Start of a block — determine array vs object from first indented line
      currentKey = key;
      currentMode = null;
    } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      // Inline flow array: ["a", "b", "c"]
      currentKey = null;
      currentMode = null;
      const inner = rawValue.slice(1, -1).trim();
      if (inner === '') {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map(item => stripQuotes(item.trim()));
      }
    } else {
      // Simple key-value
      currentKey = null;
      currentMode = null;
      result[key] = stripQuotes(rawValue);
    }
  }

  // Handle block keys that had no children (empty block)
  if (currentKey && !(currentKey in result)) {
    result[currentKey] = [];
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
