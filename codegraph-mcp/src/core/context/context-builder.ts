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
  dependsOn: GraphNode[];
  dependedOnBy: GraphNode[];
  produces: GraphNode[];
  consumes: GraphNode[];
  /** for a KAFKA_TOPIC node: which producer methods send to it */
  producedBy: GraphNode[];
  /** for a KAFKA_TOPIC node: which @KafkaListener methods consume it */
  consumedBy: GraphNode[];
  tests: GraphNode[];
  /** for a frontend API-client function: which backend REST_ENDPOINT it calls */
  mapsToEndpoint: GraphNode[];
  /** for a REST_ENDPOINT node: which frontend functions call it */
  calledFromFrontend: GraphNode[];
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
  const dependsOn = outgoing.filter((r) => r.edgeType === "DEPENDS_ON").map((r) => r.node);
  const dependedOnBy = incoming.filter((r) => r.edgeType === "DEPENDS_ON").map((r) => r.node);
  const produces = outgoing.filter((r) => r.edgeType === "PRODUCES").map((r) => r.node);
  const consumes = outgoing.filter((r) => r.edgeType === "CONSUMES").map((r) => r.node);
  const producedBy = incoming.filter((r) => r.edgeType === "PRODUCES").map((r) => r.node);
  const consumedBy = incoming.filter((r) => r.edgeType === "CONSUMES").map((r) => r.node);
  const tests = incoming.filter((r) => r.edgeType === "TESTED_BY").map((r) => r.node);
  const mapsToEndpoint = outgoing.filter((r) => r.edgeType === "MAPS_TO_ENDPOINT").map((r) => r.node);
  const calledFromFrontend = incoming.filter((r) => r.edgeType === "MAPS_TO_ENDPOINT").map((r) => r.node);

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
    dependsOn,
    dependedOnBy,
    produces,
    consumes,
    producedBy,
    consumedBy,
    tests,
    mapsToEndpoint,
    calledFromFrontend,
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
