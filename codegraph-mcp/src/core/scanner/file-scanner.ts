import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import picomatch from "picomatch";
import type { CodegraphConfig } from "../config/config.js";
import type { Ignore } from "ignore";

// `ignore`'s CJS/ESM type interop is unreliable under NodeNext resolution; require() it directly.
const ignore: (options?: { ignorecase?: boolean }) => Ignore = createRequire(import.meta.url)("ignore");

export interface ScannedFile {
  /** absolute path */
  absPath: string;
  /** path relative to project root, forward-slash separated */
  relPath: string;
  language: "java" | "typescript" | "unknown";
}

const LANGUAGE_BY_EXT: Record<string, ScannedFile["language"]> = {
  ".java": "java",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
};

export interface ScanResult {
  files: ScannedFile[];
  filesDiscovered: number;
  filesSupported: number;
  filesIgnored: number;
}

export async function scanProject(projectRoot: string, config: CodegraphConfig): Promise<ScanResult> {
  const ig = ignore();
  ig.add(config.ignore.map(globToIgnorePattern));
  ig.add(config.security.deny.map(globToIgnorePattern));

  const gitignorePath = join(projectRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    ig.add(readFileSync(gitignorePath, "utf-8"));
  }
  const codegraphIgnorePath = join(projectRoot, ".codegraphignore");
  if (existsSync(codegraphIgnorePath)) {
    ig.add(readFileSync(codegraphIgnorePath, "utf-8"));
  }

  const denyMatchers = config.security.deny.map((p) => picomatch(p));

  const files: ScannedFile[] = [];
  let discovered = 0;
  let ignored = 0;

  for (const root of config.roots) {
    const rootAbs = join(projectRoot, root);
    if (!existsSync(rootAbs)) continue;
    await walk(rootAbs);
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(projectRoot, abs).split("\\").join("/");
      if (ig.ignores(rel)) {
        ignored++;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      discovered++;
      if (denyMatchers.some((m) => m(rel))) {
        ignored++;
        continue;
      }
      const ext = extname(entry.name);
      const language = LANGUAGE_BY_EXT[ext] ?? "unknown";
      if (language === "unknown") {
        ignored++;
        continue;
      }
      files.push({ absPath: abs, relPath: rel, language });
    }
  }

  return {
    files,
    filesDiscovered: discovered,
    filesSupported: files.length,
    filesIgnored: ignored,
  };
}

function extname(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx);
}

// Globstar patterns pass through unchanged - the `ignore` package handles them natively.
function globToIgnorePattern(pattern: string): string {
  return pattern;
}
