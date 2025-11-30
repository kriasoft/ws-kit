// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

// Prepublish script run before `changeset publish`:
// 1. Replaces `workspace:^` with actual versions (npm doesn't understand workspace protocol)
// 2. Removes the `bun` export condition (only needed for local dev)
// 3. Copies LICENSE to each package root (npm includes it automatically)

import { readdirSync } from "fs";
import { join } from "path";

const scriptsDir = import.meta.dir;
const rootDir = join(scriptsDir, "..");
const packagesDir = join(rootDir, "packages");
const licenseFile = join(rootDir, "LICENSE");

const packages = readdirSync(packagesDir).filter((name) => {
  try {
    return Bun.file(join(packagesDir, name, "package.json")).size > 0;
  } catch {
    return false;
  }
});

// Build version map: @sideband/foo -> 1.2.3
const versionMap = new Map<string, string>();
for (const pkg of packages) {
  const pkgPath = join(packagesDir, pkg, "package.json");
  const pkgJson = JSON.parse(await Bun.file(pkgPath).text());
  versionMap.set(pkgJson.name, pkgJson.version);
}

const depFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

for (const pkg of packages) {
  const pkgPath = join(packagesDir, pkg, "package.json");
  const pkgJson = JSON.parse(await Bun.file(pkgPath).text());

  let updated = false;

  // Replace workspace:^ with actual versions
  for (const field of depFields) {
    const deps = pkgJson[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== "string" || !range.startsWith("workspace:"))
        continue;
      const version = versionMap.get(name);
      if (!version) {
        console.warn(`⚠ Unknown workspace dep: ${name}`);
        continue;
      }
      const prefix = range.replace("workspace:", ""); // ^, ~, or *
      deps[name] = prefix === "*" ? version : `${prefix}${version}`;
      updated = true;
    }
  }

  // Remove bun export condition from all subpaths
  if (pkgJson.exports) {
    for (const conditions of Object.values(pkgJson.exports)) {
      if (conditions && typeof conditions === "object" && "bun" in conditions) {
        delete (conditions as Record<string, unknown>).bun;
        updated = true;
      }
    }
  }

  if (updated) {
    await Bun.write(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n");
    console.log(`✓ Updated ${pkgJson.name}`);
  }

  // Copy LICENSE to package root
  try {
    const license = await Bun.file(licenseFile).text();
    await Bun.write(join(packagesDir, pkg, "LICENSE"), license);
  } catch {
    console.warn(`⚠ Failed to copy LICENSE for ${pkgJson.name}`);
  }
}

console.log("\n✓ Prepublish complete");
