#!/usr/bin/env bun
// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Release script: Prepares packages for publishing and runs changeset publish
 *
 * Steps:
 * 1. Discover all packages in packages/
 * 2. For each package, sanitize package.json:
 *    - Rewrite "workspace:*", "workspace:^", "workspace:~" to concrete semver ranges
 *    - Remove devDependencies
 *    - Fix paths for publish root
 * 3. Run "bun changeset publish" to publish to npm
 *
 * Usage:
 *   bun scripts/release.ts
 */

import { $ } from "bun";
import { promises as fs } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

const PACKAGES_DIR = path.join(import.meta.dirname, "..", "packages");

type Dict = Record<string, string>;
interface Pkg {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Dict;
  devDependencies?: Dict;
  peerDependencies?: Dict;
  optionalDependencies?: Dict;
  publishConfig?: { directory?: string };
  [k: string]: unknown;
}

const DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

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

/** Find repo root by walking up until we see a package.json with workspaces */
async function findRepoRoot(start: string): Promise<string> {
  let dir = start;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const raw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as Pkg & { workspaces?: unknown };
      if (pkg.workspaces) return dir;
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Collect {pkgName -> version} from repo's packages directory */
async function loadWorkspaceVersions(
  root: string,
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const pkgsDir = path.join(root, "packages");

  try {
    const entries = await fs.readdir(pkgsDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const pkgJson = path.join(pkgsDir, e.name, "package.json");
          try {
            const raw = await fs.readFile(pkgJson, "utf8");
            const pkg = JSON.parse(raw) as Pkg;
            if (pkg.name && pkg.version) versions.set(pkg.name, pkg.version);
          } catch {
            /* ignore non-packages */
          }
        }),
    );
  } catch {
    // If there is no packages/ dir, silently proceed
  }

  return versions;
}

/** Resolve a single "workspace:" spec to a concrete version range */
function resolveWorkspaceRange(
  spec: string,
  depName: string,
  versions: Map<string, string>,
): string {
  if (!spec.startsWith("workspace:")) return spec;

  const suffix = spec.slice("workspace:".length).trim();
  const v = versions.get(depName);
  if (!v) {
    console.warn(`[release] Missing version for ${depName}; leaving "${spec}"`);
    return spec;
  }

  if (suffix === "" || suffix === "*" || suffix === "^" || suffix === "~")
    return `${suffix === "" || suffix === "*" ? "" : suffix}${v}`;

  if (/^[~^]?\d/.test(suffix)) return suffix;

  return `^${v}`;
}

/** Normalize a path to always have leading ./ for relative files */
function normalizeRel(p: string): string {
  if (!p.startsWith("./") && !p.startsWith("../") && !p.startsWith("/")) {
    return `./${p}`;
  }
  return p;
}

/** Rewrite a single path, removing publish directory prefix */
function rewritePath(p: unknown, pubDir: string): unknown {
  if (typeof p !== "string") return p;
  const withDot = normalizeRel(p);
  const prefix = `./${pubDir.replace(/\/+$/, "")}/`;
  if (withDot.startsWith(prefix)) {
    const stripped = withDot.slice(prefix.length);
    return stripped ? `./${stripped}` : "./";
  }
  return withDot;
}

/** Rewrite bin field (string or object) */
function rewriteBin(bin: unknown, pubDir: string): unknown {
  if (typeof bin === "string") return rewritePath(bin, pubDir);
  if (bin && typeof bin === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(bin as Record<string, string>)) {
      out[k] = String(rewritePath(v, pubDir));
    }
    return out;
  }
  return bin;
}

/** Recursively rewrite all leaf string paths in exports */
function rewriteExports(x: unknown, pubDir: string): unknown {
  if (typeof x === "string") return rewritePath(x, pubDir);
  if (Array.isArray(x)) return x.map((i) => rewriteExports(i, pubDir));
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      out[k] = rewriteExports(v, pubDir);
    }
    return out;
  }
  return x;
}

/** Fix all publishRoot-relative paths in manifest */
function fixPathsForPublishRoot(pkg: Pkg, pubDir: string): Pkg {
  const out: Pkg = { ...pkg };

  for (const key of [
    "main",
    "module",
    "types",
    "typings",
    "browser",
    "unpkg",
  ]) {
    if (out[key]) out[key] = rewritePath(out[key], pubDir);
  }

  if (out.exports) out.exports = rewriteExports(out.exports, pubDir);
  if (out.bin) out.bin = rewriteBin(out.bin, pubDir);

  if (out.typesVersions && typeof out.typesVersions === "object") {
    const tvOut: Record<string, unknown> = {};
    for (const [range, mapping] of Object.entries(
      out.typesVersions as Record<string, Record<string, string[]>>,
    )) {
      const nextMap: Record<string, string[]> = {};
      for (const [pattern, arr] of Object.entries(mapping)) {
        nextMap[pattern] = (arr as string[]).map((p) =>
          String(rewritePath(p, pubDir)),
        );
      }
      tvOut[range] = nextMap;
    }
    out.typesVersions = tvOut;
  }

  if (Array.isArray(out.files)) {
    const rewritten = (out.files as string[])
      .map((f) => {
        const rewrote = rewritePath(f, pubDir);
        const str = String(rewrote);
        if (str === `./${pubDir}` || str === pubDir) return "**/*";
        return str;
      })
      .filter((f) => f && f !== "./");

    out.files = Array.from(new Set(rewritten));
  }

  return out;
}

/** Return a sanitized copy of the manifest */
function sanitizeManifest(pkg: Pkg, versions: Map<string, string>): Pkg {
  const out: Pkg = { ...pkg };

  for (const field of DEP_FIELDS) {
    const deps = out[field];
    if (!deps) continue;
    const entries = Object.entries(deps).map(([name, range]) => [
      name,
      resolveWorkspaceRange(range, name, versions),
    ]) as [string, string][];
    out[field] = Object.fromEntries(entries);
  }

  if (out.devDependencies && Object.keys(out.devDependencies).length) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { devDependencies: _, ...rest } = out as Pkg & {
      devDependencies: Dict;
    };
    Object.assign(out, rest);
  }

  // Remove publishConfig since the dist/package.json will be published as-is
  // (npm won't look for another subdirectory within the publish directory)
  delete out.publishConfig;

  return out;
}

/** Prepack a single package directory */
async function prepackPackage(
  pkgDir: string,
  root: string,
  versions: Map<string, string>,
): Promise<void> {
  const pkgPath = path.join(pkgDir, "package.json");
  const raw = await fs.readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Pkg;

  const cleaned = sanitizeManifest(pkg, versions);
  const publishDir =
    (pkg.publishConfig && pkg.publishConfig.directory) || "dist";
  const fixedPaths = fixPathsForPublishRoot(cleaned, publishDir);

  const outDir = path.join(pkgDir, publishDir);
  await fs.mkdir(outDir, { recursive: true });

  const outPath = path.join(outDir, "package.json");
  await fs.writeFile(
    outPath,
    JSON.stringify(fixedPaths, null, 2) + "\n",
    "utf8",
  );
  console.log(`[prepack] Wrote ${path.relative(root, outPath)}`);
}

async function main() {
  console.log("[release] Discovering packages...");
  const packages = await discoverPackages();
  console.log(`[release] Found ${packages.length} packages\n`);

  const root = await findRepoRoot(PACKAGES_DIR);
  const versions = await loadWorkspaceVersions(root);

  console.log("[release] Running prepack for each package...");
  for (const pkg of packages) {
    const pkgDir = path.join(PACKAGES_DIR, pkg);
    console.log(`[prepack] ${pkg}`);

    try {
      await prepackPackage(pkgDir, root, versions);
    } catch (err) {
      console.error(`[prepack] Failed for ${pkg}:`, err);
      process.exit(1);
    }
  }

  console.log(
    "\n[release] All packages prepared. Running changeset publish...\n",
  );

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
