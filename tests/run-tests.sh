#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
ERRORS=""

for test_file in "$SCRIPT_DIR"/test-*.js; do
  # Handle case where glob matches nothing (returns literal string)
  [ -e "$test_file" ] || continue

  test_name="$(basename "$test_file" .js)"
  if node "$test_file" 2>&1; then
    PASS=$((PASS + 1))
    echo "PASS  $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL  $test_name"
    echo "FAIL  $test_name"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo -e "\nFailures:$ERRORS"
  exit 1
fi
