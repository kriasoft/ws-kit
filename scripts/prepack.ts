#!/usr/bin/env bun
// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Prepack sanitizer:
 * - Rewrites "workspace:*", "workspace:^", "workspace:~" to concrete ranges
 * - Leaves explicit ranges ("workspace:^1.2.3") as-is
 * - Removes devDependencies (consumers don't need them)
 * - Writes cleaned manifest to publish directory (default "dist/")
 *   or in-place if run with "--in-place"
 *
 * Usage:
 *   bun run ../../scripts/prepack.ts           # writes dist/package.json
 *   bun run ../../scripts/prepack.ts --in-place
 */

import { promises as fs } from "node:fs";
import path from "node:path";

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

const CWD = process.cwd();
const IN_PLACE = process.argv.includes("--in-place");

/** Find repo root by walking up until we see a package.json (and prefer one with "workspaces") */
async function findRepoRoot(start = CWD): Promise<string> {
  let dir = start;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const raw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as Pkg & { workspaces?: unknown };
      // Prefer the first package.json that has workspaces; else fall back to top-most package.json
      if (pkg.workspaces) return dir;
      // If reached filesystem root, return last seen package.json dir
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // last attempt: climb again and return the first place that had a package.json
      return start; // fallback; shouldn't really happen in a normal monorepo
    }
    dir = parent;
  }
}

/** Collect {pkgName -> version} from repo's packages directory (simple, dependency-free) */
async function loadWorkspaceVersions(
  root: string,
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();

  // Heuristic: <root>/packages/*/package.json
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
    // If there is no packages/ dir, silently proceed (script still works for single-package repos)
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

  const suffix = spec.slice("workspace:".length).trim(); // "", "*", "^", "~", "^1.2.3", "1.2.3", ...
  const v = versions.get(depName);
  if (!v) {
    console.warn(`[prepack] Missing version for ${depName}; leaving "${spec}"`);
    return spec;
  }

  // token-only forms -> apply token to actual version
  if (suffix === "" || suffix === "*" || suffix === "^" || suffix === "~")
    return `${suffix === "" || suffix === "*" ? "" : suffix}${v}`;

  // explicit numeric (optionally prefixed with ^ or ~): keep as-is
  if (/^[~^]?\d/.test(suffix)) return suffix;

  // unknown token -> default to caret
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
  // Strip the publish directory prefix to make paths relative to the published root
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

  // Single-path fields
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

  // exports (deeply nested)
  if (out.exports) out.exports = rewriteExports(out.exports, pubDir);

  // bin (string or map)
  if (out.bin) out.bin = rewriteBin(out.bin, pubDir);

  // typesVersions (map of version ranges -> map of patterns -> paths)
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

  // files: when publishing from dist/, rewrite paths to remove the publish dir prefix.
  // e.g., files: ["dist", "LICENSE"] becomes ["**/*", "LICENSE"] after stripping "dist/"
  if (Array.isArray(out.files)) {
    const rewritten = (out.files as string[])
      .map((f) => {
        const rewrote = rewritePath(f, pubDir);
        // If rewriting returns the same path as the publish dir itself (e.g., "./dist"),
        // replace it with **/* to include all published files
        const str = String(rewrote);
        if (str === `./${pubDir}` || str === pubDir) return "**/*";
        return str;
      })
      .filter((f) => f && f !== "./"); // Remove empty entries

    // Deduplicate in case we ended up with multiple "**/*" entries
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

  // Drop devDependencies for published artifact
  if (out.devDependencies && Object.keys(out.devDependencies).length) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { devDependencies: _, ...rest } = out as Pkg & {
      devDependencies: Dict;
    };
    Object.assign(out, rest);
  }

  return out;
}

/** Main */
(async function main() {
  const pkgPath = path.join(CWD, "package.json");
  const raw = await fs.readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Pkg;
  const root = await findRepoRoot();
  const versions = await loadWorkspaceVersions(root);

  const cleaned = sanitizeManifest(pkg, versions);

  if (IN_PLACE) {
    await fs.writeFile(
      pkgPath,
      JSON.stringify(cleaned, null, 2) + "\n",
      "utf8",
    );
    console.log(`[prepack] Updated ${path.relative(root, pkgPath)} (in-place)`);
    return;
  }

  // Write to publish directory (default "dist" or publishConfig.directory)
  const publishDir =
    (pkg.publishConfig && pkg.publishConfig.directory) || "dist";

  // Fix all paths in the manifest for the publish root
  const fixedPaths = fixPathsForPublishRoot(cleaned, publishDir);

  const outDir = path.join(CWD, publishDir);
  await fs.mkdir(outDir, { recursive: true });

  const outPath = path.join(outDir, "package.json");
  await fs.writeFile(
    outPath,
    JSON.stringify(fixedPaths, null, 2) + "\n",
    "utf8",
  );
  console.log(`[prepack] Wrote ${path.relative(root, outPath)}`);
})().catch((err) => {
  console.error("[prepack] Failed:", err);
  process.exitCode = 1;
});
