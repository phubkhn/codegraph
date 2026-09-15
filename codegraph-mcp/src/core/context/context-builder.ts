import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GraphQueryService } from "../query/graph-query-service.js";
import type { GraphNode } from "../model/types.js";

export interface SymbolContext {
  node: GraphNode;
  source?: string;
  truncatedSource: boolean;
  callers: GraphNode[];
  callees: GraphNode[];
  relatedEndpoints: GraphNode[];
  usesHooks: GraphNode[];
  renders: GraphNode[];
  renderedBy: GraphNode[];
  extendsImplements: GraphNode[];
  tests: GraphNode[];
}

export interface ExploreOptions {
  maxSourceLines: number;
  includeSource: boolean;
  matchLimit?: number;
}

export async function buildExploreContext(
  query: string,
  projectRoot: string,
  queryService: GraphQueryService,
  options: ExploreOptions,
): Promise<SymbolContext[]> {
  const matches = queryService.searchSymbols(query, options.matchLimit ?? 5);
  const results: SymbolContext[] = [];
  for (const node of matches) {
    results.push(await buildSymbolContext(node, projectRoot, queryService, options));
  }
  return results;
}

export async function buildSymbolContext(
  node: GraphNode,
  projectRoot: string,
  queryService: GraphQueryService,
  options: ExploreOptions,
): Promise<SymbolContext> {
  const outgoing = queryService.getOutgoingByType(node.id);
  const incoming = queryService.getIncomingByType(node.id);

  const callers = incoming.filter((r) => r.edgeType === "CALLS").map((r) => r.node);
  const callees = outgoing.filter((r) => r.edgeType === "CALLS").map((r) => r.node);
  const relatedEndpoints = callers.filter((n) => n.type === "REST_ENDPOINT");
  const usesHooks = outgoing.filter((r) => r.edgeType === "USES_HOOK").map((r) => r.node);
  const renders = outgoing.filter((r) => r.edgeType === "RENDERS").map((r) => r.node);
  const renderedBy = incoming.filter((r) => r.edgeType === "RENDERS").map((r) => r.node);
  const extendsImplements = outgoing.filter((r) => r.edgeType === "EXTENDS" || r.edgeType === "IMPLEMENTS").map((r) => r.node);
  const tests: GraphNode[] = []; // reserved for a future TESTED_BY edge type

  let source: string | undefined;
  let truncatedSource = false;
  if (options.includeSource && node.startLine && node.endLine) {
    const read = await readSourceSlice(projectRoot, node.file, node.startLine, node.endLine, options.maxSourceLines);
    source = read.text;
    truncatedSource = read.truncated;
  }

  return {
    node,
    source,
    truncatedSource,
    callers,
    callees,
    relatedEndpoints,
    usesHooks,
    renders,
    renderedBy,
    extendsImplements,
    tests,
  };
}

async function readSourceSlice(
  projectRoot: string,
  relFile: string,
  startLine: number,
  endLine: number,
  maxLines: number,
): Promise<{ text: string; truncated: boolean }> {
  try {
    const content = await readFile(join(projectRoot, relFile), "utf-8");
    const lines = content.split("\n");
    const end = Math.min(endLine, lines.length, startLine + maxLines - 1);
    const slice = lines.slice(startLine - 1, end);
    return { text: slice.join("\n"), truncated: end < endLine };
  } catch {
    return { text: "", truncated: false };
  }
}
