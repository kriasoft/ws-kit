#!/usr/bin/env bun
// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Release script: Prepares packages for publishing and runs changeset publish
 *
 * Steps:
 * 1. Discover all packages in packages/
 * 2. Run prepack for each package (generates dist/package.json with resolved deps)
 * 3. Run "bun changeset publish" to publish to npm
 *
 * Usage:
 *   bun scripts/release.ts
 */

import { $ } from "bun";
import { readdirSync } from "node:fs";
import path from "node:path";

const PACKAGES_DIR = path.join(import.meta.dirname, "..", "packages");

async function discoverPackages(): Promise<string[]> {
  const entries: string[] = [];

  try {
    const files = readdirSync(PACKAGES_DIR, { withFileTypes: true });
    for (const file of files) {
      if (file.isDirectory()) {
        const pkgPath = path.join(PACKAGES_DIR, file.name, "package.json");
        const pkgExists = await Bun.file(pkgPath).exists();
        if (pkgExists) {
          entries.push(file.name);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return entries;
}

async function main() {
  console.log("[release] Discovering packages...");
  const packages = await discoverPackages();
  console.log(`[release] Found ${packages.length} packages\n`);

  // Step 1: Run prepack for each package
  console.log("[release] Running prepack for each package...");
  for (const pkg of packages) {
    const pkgDir = path.join(PACKAGES_DIR, pkg);
    console.log(`[prepack] ${pkg}`);

    try {
      await $`cd ${pkgDir} && bun run prepack`;
    } catch (err) {
      console.error(`[prepack] Failed for ${pkg}:`, err);
      process.exit(1);
    }
  }

  console.log(
    "\n[release] All packages prepared. Running changeset publish...\n",
  );

  // Step 2: Run changeset publish
  try {
    await $`bun changeset publish`;
  } catch (err) {
    console.error("[release] Publish failed:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[release] Error:", err);
  process.exit(1);
});
