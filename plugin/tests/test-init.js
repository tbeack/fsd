#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { initProject } = require(path.join(__dirname, '..', 'scripts', 'init.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
}

// Test 1: Creates .fsd/ directory structure
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir);

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'config.yaml')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'agents')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'commands')), true);

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 2: Config template has expected content
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);

  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.ok(config.includes('workflow:'));
  assert.ok(config.includes('disabled:'));

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 3: Does not overwrite existing .fsd/
{
  const tmpDir = mkTmpDir();
  fs.mkdirSync(path.join(tmpDir, '.fsd'));
  fs.writeFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'workflow: custom');

  const result = initProject(tmpDir);
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('already exists'));

  // Original content preserved
  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.strictEqual(config, 'workflow: custom');

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 4: Config template includes (commented) structure section
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);
  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  assert.ok(config.includes('structure:'), 'CONFIG_TEMPLATE should mention structure:');
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 5: initProject honors structure override and scaffolds renamed dirs
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir, { structure: { skills: 'capabilities' } });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'capabilities')), true, 'capabilities dir should exist');
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills')), false, 'default skills dir should NOT exist when overridden');
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'agents')), true, 'agents default still applies');
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'commands')), true, 'commands default still applies');

  fs.rmSync(tmpDir, { recursive: true });
}

// Test 6: initProject with full structure override
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir, { structure: { skills: 'a', agents: 'b', commands: 'c' } });
  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'a')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'b')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'c')), true);
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 7: initProject with malformed structure falls back to defaults
{
  const tmpDir = mkTmpDir();
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = () => true; // suppress the warning output in tests
  try {
    const result = initProject(tmpDir, { structure: { skills: 'bad/path' } });
    assert.strictEqual(result.success, true);
    // Falls back to defaults
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'skills')), true);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
  fs.rmSync(tmpDir, { recursive: true });
}

// --- Storage-kind scaffold (FSD-013) ---

// Test 8: initProject scaffolds the 3 storage kinds in addition to scannable kinds
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir);
  assert.strictEqual(result.success, true);
  for (const kind of ['spec', 'plan', 'research']) {
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, '.fsd', kind)),
      true,
      `.fsd/${kind}/ should exist after init`,
    );
  }
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 9: each storage dir contains a .gitkeep so git tracks it when empty
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);
  for (const kind of ['spec', 'plan', 'research']) {
    const keep = path.join(tmpDir, '.fsd', kind, '.gitkeep');
    assert.strictEqual(fs.existsSync(keep), true, `.fsd/${kind}/.gitkeep should exist`);
  }
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 10: scannable kind dirs do NOT get a .gitkeep (content authored separately)
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);
  for (const kind of ['skills', 'agents', 'commands']) {
    const keep = path.join(tmpDir, '.fsd', kind, '.gitkeep');
    assert.strictEqual(fs.existsSync(keep), false, `.fsd/${kind}/.gitkeep should NOT exist`);
  }
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 11: CONFIG_TEMPLATE documents storage kinds in the commented structure block
{
  const tmpDir = mkTmpDir();
  initProject(tmpDir);
  const config = fs.readFileSync(path.join(tmpDir, '.fsd', 'config.yaml'), 'utf-8');
  for (const kind of ['spec', 'plan', 'research']) {
    assert.ok(
      config.includes(`# ${kind}: ${kind}`),
      `CONFIG_TEMPLATE should document structure.${kind}`,
    );
  }
  fs.rmSync(tmpDir, { recursive: true });
}

// Test 12: renaming a storage kind via structure override scaffolds the new dir
{
  const tmpDir = mkTmpDir();
  const result = initProject(tmpDir, { structure: { spec: 'specifications' } });
  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'specifications')), true);
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'spec')), false);
  // .gitkeep goes in the renamed dir
  assert.strictEqual(fs.existsSync(path.join(tmpDir, '.fsd', 'specifications', '.gitkeep')), true);
  fs.rmSync(tmpDir, { recursive: true });
}

console.log('  All init tests passed');
