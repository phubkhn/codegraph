import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodegraphConfig } from "./config/config.js";
import { scanProject } from "./scanner/file-scanner.js";
import { ParserRegistry } from "./parser/parser-registry.js";
import { JavaParser } from "../languages/java/java-parser.js";
import { TypeScriptParser } from "../languages/typescript/ts-parser.js";
import { applySpringTags } from "../languages/java/spring-tags.js";
import { applyReactTags } from "../languages/typescript/react-tags.js";
import { SqliteGraphStore } from "./storage/sqlite-store.js";
import { ProjectIndex } from "./graph/project-index.js";
import { buildGraph } from "./graph/graph-builder.js";
import type { ParsedFile } from "./model/types.js";

export interface IndexOptions {
  force?: boolean;
  onProgress?: (msg: string) => void;
}

export interface IndexSummary {
  filesDiscovered: number;
  filesSupported: number;
  filesIgnored: number;
  filesParsed: number;
  filesSkippedUnchanged: number;
  filesDeleted: number;
  filesFailed: number;
  nodesWritten: number;
  edgesWritten: number;
  durationMs: number;
}

export function createParserRegistry(config: CodegraphConfig): ParserRegistry {
  const registry = new ParserRegistry();
  if (config.languages.java) registry.register(new JavaParser());
  if (config.languages.typescript) registry.register(new TypeScriptParser());
  return registry;
}

export async function runIndex(projectRoot: string, config: CodegraphConfig, options: IndexOptions = {}): Promise<IndexSummary> {
  const started = Date.now();
  const log = options.onProgress ?? (() => {});
  const dbPath = join(projectRoot, config.storage.path);
  const store = new SqliteGraphStore(dbPath);

  try {
    const scan = await scanProject(projectRoot, config);
    log(`Files discovered: ${scan.filesDiscovered}, supported: ${scan.filesSupported}, ignored: ${scan.filesIgnored}`);

    const scannedByPath = new Map(scan.files.map((f) => [f.relPath, f]));
    const existingFiles = store.listFiles();
    const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));

    // Files removed from disk since the last index.
    const deletedPaths = existingFiles.filter((f) => !scannedByPath.has(f.path)).map((f) => f.path);
    for (const p of deletedPaths) store.deleteFileGraph(p);

    const registry = createParserRegistry(config);
    const toParse: { absPath: string; relPath: string; language: string }[] = [];
    let skippedUnchanged = 0;

    for (const file of scan.files) {
      const parser = registry.resolve(file.relPath);
      if (!parser) continue;
      const existing = existingByPath.get(file.relPath);
      if (!options.force && existing) {
        const source = await readFile(file.absPath, "utf-8").catch(() => null);
        if (source === null) continue;
        const hash = hashOf(source);
        if (hash === existing.hash) {
          skippedUnchanged++;
          continue;
        }
      }
      toParse.push(file);
    }

    // Re-index changed files: drop their stale graph data first.
    for (const f of toParse) store.deleteFileGraph(f.relPath);

    const parsedFiles: ParsedFile[] = [];
    let failed = 0;
    for (const file of toParse) {
      const source = await readFile(file.absPath, "utf-8").catch(() => null);
      if (source === null) continue;
      const parser = registry.resolve(file.relPath)!;
      const parsed = await parser.parse(file.relPath, source);
      if (parsed.parseError) {
        failed++;
        log(`parse error: ${file.relPath}: ${parsed.parseError}`);
      }
      if (parsed.language === "java" && config.frameworks.spring) applySpringTags(parsed);
      if (parsed.language === "typescript" && config.frameworks.react) applyReactTags(parsed);
      parsedFiles.push(parsed);
      store.upsertFile(file.relPath, file.language, hashOf(source));
    }

    log(`Parsed ${parsedFiles.length} file(s), ${failed} failure(s), ${skippedUnchanged} unchanged skipped`);

    const index = new ProjectIndex();
    index.addAll(store.allNodes());

    const { nodes, edges } = buildGraph(parsedFiles, index);
    store.insertNodes(nodes);
    store.insertEdges(edges);

    return {
      filesDiscovered: scan.filesDiscovered,
      filesSupported: scan.filesSupported,
      filesIgnored: scan.filesIgnored,
      filesParsed: parsedFiles.length,
      filesSkippedUnchanged: skippedUnchanged,
      filesDeleted: deletedPaths.length,
      filesFailed: failed,
      nodesWritten: nodes.length,
      edgesWritten: edges.length,
      durationMs: Date.now() - started,
    };
  } finally {
    store.close();
  }
}

function hashOf(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}
