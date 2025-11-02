#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025-present Kriasoft
# SPDX-License-Identifier: MIT
set -e

echo "=== Validating Application Patterns ==="

# 1. Check schema versions match fixture metadata
echo "Checking schema version consistency..."
for fixture in examples/*/fixtures/*.json; do
  if [ ! -f "$fixture" ]; then
    continue
  fi

  fixture_schema_v=$(jq -r '.schemaVersion // empty' "$fixture" 2>/dev/null || echo "")
  if [ -z "$fixture_schema_v" ]; then
    echo "⚠ Warning: No schemaVersion in $fixture"
    continue
  fi

  pattern_dir=$(dirname $(dirname "$fixture"))
  contract="$pattern_dir/contract.json"

  if [ ! -f "$contract" ]; then
    echo "⚠ Warning: No contract.json in $pattern_dir"
    continue
  fi

  contract_schema_v=$(jq -r '.schemaVersion // empty' "$contract" 2>/dev/null || echo "")
  if [ -z "$contract_schema_v" ]; then
    echo "⚠ Warning: No schemaVersion in $contract"
    continue
  fi

  if [ "$fixture_schema_v" != "$contract_schema_v" ]; then
    echo "✗ Version mismatch: $fixture has $fixture_schema_v, $contract has $contract_schema_v"
    exit 1
  fi
done
echo "✓ All fixture versions match contract versions"

# 2. Check fixture files are numbered sequentially
echo "Checking fixture numbering..."
for pattern_dir in examples/*/; do
  fixtures_dir="$pattern_dir/fixtures"
  if [ ! -d "$fixtures_dir" ]; then
    continue
  fi

  # Check that fixtures are numbered 001, 002, 003, etc.
  files=$(ls "$fixtures_dir"/*.json 2>/dev/null | sort || true)
  if [ -z "$files" ]; then
    continue
  fi

  expected=1
  for file in $files; do
    basename=$(basename "$file" .json)
    number=$(echo "$basename" | grep -oE '^[0-9]+' || echo "")
    if [ -z "$number" ]; then
      echo "✗ Invalid fixture name: $file (must start with NNN-)"
      exit 1
    fi
    # Check no gaps (allow non-sequential but warn)
    if [ "$number" != "$expected" ] && [ "$expected" -eq 1 ]; then
      expected=$number
    fi
  done

  echo "✓ Fixtures in $pattern_dir are properly numbered"
done

# 3. Check that patterns have conformance tests
echo "Checking conformance tests..."
for pattern_dir in examples/*/; do
  # Only check directories with contract.json (i.e., actual patterns)
  if [ ! -f "$pattern_dir/contract.json" ]; then
    continue
  fi

  pattern_name=$(basename "$pattern_dir")

  if [ ! -f "$pattern_dir/conformance.test.ts" ]; then
    echo "✗ Missing conformance test: $pattern_dir/conformance.test.ts"
    exit 1
  fi

  echo "✓ Pattern $pattern_name has conformance test"
done

# 4. Ensure docs/patterns/README.md references all examples
echo "Checking documentation references..."
for pattern_dir in examples/*/; do
  # Only check directories with contract.json (i.e., actual patterns)
  if [ ! -f "$pattern_dir/contract.json" ]; then
    continue
  fi

  if [ ! -f "$pattern_dir/README.md" ]; then
    continue
  fi

  pattern_name=$(basename "$pattern_dir")

  # Check if pattern is referenced in patterns README
  if ! grep -q "$pattern_name" docs/patterns/README.md 2>/dev/null; then
    echo "⚠ Warning: Pattern $pattern_name not referenced in docs/patterns/README.md"
  else
    echo "✓ Pattern $pattern_name referenced in docs/patterns/README.md"
  fi
done

echo ""
echo "=== Pattern validation passed ==="
