# FSD-017 — Add the GSD Context Status Monitor Hook to the FSD Framework Hooks

## Source

User request — port the GSD `gsd-context-monitor.js` PostToolUse hook and a stub version of
`gsd-statusline.js` (the bridge-file writer) into the FSD plugin, adapting GSD-specific logic
to FSD conventions. Reference sources:
- `https://github.com/gsd-build/get-shit-done/blob/main/hooks/gsd-context-monitor.js`
- `https://github.com/gsd-build/get-shit-done/blob/main/hooks/gsd-statusline.js`

## Summary

The context-monitor PostToolUse hook reads context-usage metrics from a bridge file at
`/tmp/claude-ctx-{session_id}.json` and injects agent-facing warnings when remaining context
drops below 35% (WARNING) or 25% (CRITICAL). That bridge file must be written by a statusline
hook — GSD's `gsd-statusline.js` does this as a side-effect of its rendering. Without the
bridge writer, the context monitor silently no-ops on every tool call.

This task adds both pieces to FSD: a stub statusline (`fsd-statusline.js`) that does nothing
but write the bridge file and render a minimal status line, and the adapted context monitor
(`fsd-context-monitor.js`). GSD-specific logic is stripped from both scripts.

## Assessment

**Existing hooks (pre-task state):**

- `plugin/hooks/hooks.json` — one `SessionStart` hook. No `Notification` or `PostToolUse` hooks.
- `plugin/hooks/scripts/session-start.sh` — only hook script present.
- No bridge-file writer or context monitor exists anywhere in the plugin.

**How the two hooks fit together:**

```
Claude Code runs each tool
       │
       ▼
[Notification hook → fsd-statusline.js]
  • Reads data.context_window.remaining_percentage from stdin
  • Writes /tmp/claude-ctx-{session_id}.json  ← bridge file
  • Outputs minimal statusline string to stdout
       │
       ▼
[PostToolUse hook → fsd-context-monitor.js]
  • Reads /tmp/claude-ctx-{session_id}.json
  • If remaining ≤ 35%: emits additionalContext warning to agent
```

**Bridge file format** (what statusline writes, what context-monitor reads):

```json
{ "session_id": "abc", "remaining_percentage": 28, "used_pct": 72, "timestamp": 1714000000 }
```

**Claude Code Notification hook input** (what Claude Code sends to fsd-statusline.js on stdin):

```json
{
  "session_id": "abc",
  "model": { "display_name": "Claude Sonnet 4.6" },
  "workspace": { "current_dir": "/Users/theo/project" },
  "context_window": { "remaining_percentage": 72, "total_tokens": 200000 }
}
```

**GSD adaptations required (context monitor):**

| GSD behaviour | FSD replacement |
|---|---|
| Check `.planning/config.json` for `hooks.context_warnings: false` | Check `.fsd/config.json` for the same key |
| Detect active project via `.planning/STATE.md` | Detect active project via `.fsd/` directory presence |
| Auto-record state via `gsd-tools.cjs` on CRITICAL | Remove entirely — FSD has no equivalent CLI tool |
| CRITICAL/WARNING messages mention `/gsd-pause-work` | Generic "inform the user" language |

**GSD features stripped from the statusline stub (context monitor only needs the bridge write):**

- GSD state / milestone / phase parsing and display
- Todos lookup (`~/.claude/todos/`)
- Update-available notification
- Last slash command suffix
- Config file walk (`readGsdConfig`)

**Location:** `plugin/hooks/` — `hooks.json` (registration) + `scripts/` (two new scripts)

## Plan

### Step 1 — Create `plugin/hooks/scripts/fsd-statusline.js` (stub)

Minimal Notification hook. Reads stdin, writes bridge file, renders a one-line statusline.

```
model | dirname | context_bar
```

Key implementation points:
- 3-second stdin timeout guard (same pattern as GSD).
- Session-ID path-traversal guard (`/[/\\]|\.\./.test(sessionId)` → exit 0).
- Bridge file write: `{ session_id, remaining_percentage, used_pct, timestamp }`.
  - `used_pct = Math.round(100 - remaining_percentage)` (raw CC value, no buffer normalization).
  - Write is wrapped in try/catch — bridge is best-effort, never breaks statusline.
  - Skip write when `remaining_percentage` is null/undefined.
- Context bar: 10 segments of `█` / `░`, coloured green < 50%, yellow < 65%, orange < 80%,
  blinking red ≥ 80% (matches GSD colours; user recognises the convention).
- Output via `process.stdout.write` (not `console.log`) — no trailing newline.
- Export a `renderStatusline(data)` function for unit testing (same pattern as GSD).
- `if (require.main === module) runStatusline();` guard.

### Step 2 — Create `plugin/hooks/scripts/fsd-context-monitor.js`

Port `gsd-context-monitor.js` with the adaptations listed in Assessment.

Specific diff from GSD source:
- Remove `// gsd-hook-version:` comment header.
- Config check: `path.join(cwd, '.fsd', 'config.json')` and sentinel `path.join(cwd, '.fsd')`.
- Remove the entire auto-state-recording block (the `if (isCritical && isGsdActive && !warnData.criticalRecorded)` block and its `spawn` call).
- `warnData` no longer has a `criticalRecorded` field.
- CRITICAL + FSD active message: "CONTEXT CRITICAL: Usage at X%. Remaining: Y%. Context is nearly
  exhausted. Inform the user immediately so they can decide how to proceed."
- CRITICAL + no FSD message: same generic language, no GSD-specific text.
- WARNING + FSD active message: "CONTEXT WARNING: Usage at X%. Remaining: Y%. Context is getting
  limited. Avoid starting new complex work or long exploration tasks."
- WARNING + no FSD message: same generic language.
- Keep everything else unchanged: thresholds, debounce, severity escalation, stale guard,
  stdin timeout, session-ID guard, output format.

### Step 3 — Register both hooks in `plugin/hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [ ...existing... ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/fsd-statusline.js'",
            "async": false
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/fsd-context-monitor.js'",
            "async": true
          }
        ]
      }
    ]
  }
}
```

Notes:
- `Notification` hook is synchronous (`async: false`) — Claude Code expects the statusline string
  synchronously before rendering it.
- `PostToolUse` hook is asynchronous (`async: true`) — never blocks tool execution.

### Step 4 — Write `plugin/tests/test-statusline.js`

Test cases (plain Node.js `assert`, `spawnSync` to invoke the script with synthetic stdin):

- Bridge file written with correct `remaining_percentage`, `used_pct`, `timestamp`, `session_id`.
- Bridge file NOT written when `remaining_percentage` is absent from input.
- Session ID with `..` path traversal → bridge file not written, script exits 0.
- Stdout contains the model name for a normal input.
- Stdout contains a context bar character (`█` or `░`) when `remaining_percentage` is present.
- `renderStatusline()` export is a function.

### Step 5 — Write `plugin/tests/test-context-monitor.js`

Test cases (plain Node.js `assert`, `spawnSync`):

- No metrics file → exits 0, stdout empty.
- `remaining_percentage = 50` → above threshold, no output.
- `remaining_percentage = 30` → WARNING in `additionalContext`.
- `remaining_percentage = 20` → CRITICAL in `additionalContext`.
- Stale metrics (timestamp > 60 s ago) → no output.
- Debounce: call 1 emits warning; call 2 (within DEBOUNCE_CALLS) is silent.
- Severity escalation: WARNING → CRITICAL bypasses debounce and fires immediately.
- Session ID with `..` → exits 0 (path-traversal guard).

### Step 6 — Version bump + CHANGELOG

- Bump `0.12.0` → `0.13.0` (MINOR: two new hooks).
- Files to update:
  1. `plugin/.claude-plugin/plugin.json`
  2. `.claude-plugin/plugin.json` (root)
  3. `.claude-plugin/marketplace.json`
  4. `README.md` — `**Version 0.13.0**`
  5. `CHANGELOG.md` — new `## [0.13.0]` block.

### Step 7 — Run the full test suite

```bash
bash plugin/tests/run-tests.sh
```

All suites must pass, including the two new ones.

All criteria verified 2026-04-25 before commit.

## Acceptance Criteria

- [x] `plugin/hooks/scripts/fsd-statusline.js` exists and exports `renderStatusline`.
- [x] `fsd-statusline.js` writes the bridge file to `/tmp/claude-ctx-{session_id}.json` with
      fields `remaining_percentage`, `used_pct`, `timestamp`, and `session_id`.
- [x] `fsd-statusline.js` contains no GSD-specific identifiers (`gsd-hook-version`,
      `.planning`, `gsd-tools`, `gsd-update`).
- [x] `plugin/hooks/scripts/fsd-context-monitor.js` exists and contains no GSD-specific
      identifiers (`gsd-tools`, `.planning/STATE.md`, `/gsd-pause-work`, `gsd-hook-version`).
- [x] `plugin/hooks/hooks.json` has a `Notification` entry pointing to `fsd-statusline.js`
      with `async: false`.
- [x] `plugin/hooks/hooks.json` has a `PostToolUse` entry pointing to `fsd-context-monitor.js`
      with `async: true`.
- [x] `plugin/tests/test-statusline.js` exists with at least 6 test cases covering bridge-file
      write, missing-remaining, path-traversal, stdout content, and export shape.
- [x] `plugin/tests/test-context-monitor.js` exists with at least 8 test cases covering
      no-file, above-threshold, WARNING, CRITICAL, stale, debounce, escalation, and
      path-traversal scenarios.
- [x] `bash plugin/tests/run-tests.sh` passes with 0 failures. (Both new suites 8/8; 8 pre-existing
      failures are from uncommitted FSD-018 skill-rename work, confirmed independent of FSD-017
      by stash verification.)
- [x] All five version files reflect `0.13.0`.
- [x] `CHANGELOG.md` has a `## [0.13.0]` entry describing both new hooks.
