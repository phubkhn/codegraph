import type { GraphNode } from "./model/types.js";
import type { SymbolContext } from "./context/context-builder.js";
import type { ImpactResult, PathResult } from "./query/graph-query-service.js";

export function formatNodeRef(node: GraphNode): string {
  const loc = node.startLine ? `${node.file}:${node.startLine}` : node.file;
  return `${node.qualifiedName} [${node.type}] (${loc})`;
}

export function formatExploreResult(contexts: SymbolContext[]): string {
  if (contexts.length === 0) return "No matching symbol found.";
  return contexts.map(formatSymbolContext).join("\n\n---\n\n");
}

function formatSymbolContext(ctx: SymbolContext): string {
  const lines: string[] = [];
  lines.push(`## Symbol: ${ctx.node.qualifiedName}`);
  lines.push(`Type: ${ctx.node.type}`);
  lines.push(`Location: ${ctx.node.file}${ctx.node.startLine ? `:${ctx.node.startLine}-${ctx.node.endLine}` : ""}`);
  if (ctx.node.metadata && Object.keys(ctx.node.metadata).length > 0) {
    lines.push(`Metadata: ${JSON.stringify(ctx.node.metadata)}`);
  }

  if (ctx.relatedEndpoints.length > 0) {
    lines.push("", "### Related REST endpoints", ...ctx.relatedEndpoints.map((n) => `- ${formatNodeRef(n)}`));
  }
  if (ctx.renderedBy.length > 0) {
    lines.push("", "### Rendered by (React components)", ...ctx.renderedBy.map((n) => `- ${formatNodeRef(n)}`));
  }
  lines.push("", "### Callers", ...(ctx.callers.length ? ctx.callers.map((n) => `- ${formatNodeRef(n)}`) : ["(none found)"]));
  lines.push("", "### Callees", ...(ctx.callees.length ? ctx.callees.map((n) => `- ${formatNodeRef(n)}`) : ["(none found)"]));
  if (ctx.usesHooks.length > 0) {
    lines.push("", "### Uses hooks", ...ctx.usesHooks.map((n) => `- ${formatNodeRef(n)}`));
  }
  if (ctx.renders.length > 0) {
    lines.push("", "### Renders", ...ctx.renders.map((n) => `- ${formatNodeRef(n)}`));
  }
  if (ctx.extendsImplements.length > 0) {
    lines.push("", "### Extends / implements", ...ctx.extendsImplements.map((n) => `- ${formatNodeRef(n)}`));
  }

  if (ctx.source) {
    lines.push("", "### Source", "```", ctx.source, "```");
    if (ctx.truncatedSource) lines.push("(source truncated by maxSourceLines)");
  }

  return lines.join("\n");
}

export function formatImpactResult(result: ImpactResult): string {
  const lines: string[] = [];
  lines.push(`## Impact analysis for: ${result.root.qualifiedName}`);
  lines.push(`Location: ${formatNodeRef(result.root)}`);

  if (result.affected.length === 0) {
    lines.push("", "No dependents found (nothing appears to call, render, extend, or implement this symbol).");
    return lines.join("\n");
  }

  const byType = new Map<string, GraphNode[]>();
  for (const { node } of result.affected) {
    const key = groupKey(node);
    const arr = byType.get(key) ?? [];
    arr.push(node);
    byType.set(key, arr);
  }

  for (const [group, nodes] of byType) {
    lines.push("", `### Affected ${group}`, ...nodes.map((n) => `- ${formatNodeRef(n)}`));
  }

  if (result.truncated) {
    lines.push("", `(truncated at maxNodes limit; results may be incomplete)`);
  }

  return lines.join("\n");
}

function groupKey(node: GraphNode): string {
  switch (node.type) {
    case "REST_ENDPOINT":
      return "endpoints";
    case "REACT_COMPONENT":
      return "React components";
    case "REACT_HOOK":
      return "React hooks";
    case "CLASS":
    case "INTERFACE":
      return "classes/interfaces";
    case "METHOD":
    case "FUNCTION":
      return "methods/functions";
    default:
      return node.type.toLowerCase();
  }
}

export function formatPathResult(result: PathResult | undefined, from: string, to: string): string {
  if (!result) return `No path found from "${from}" to "${to}" within the configured max depth.`;
  const steps = result.nodes.map((n, i) => {
    const edge = result.edges[i - 1];
    const arrow = edge ? `  --[${edge.type}]-->` : "";
    return `${arrow}\n${formatNodeRef(n)}`;
  });
  return `## Path: ${from} -> ${to}\n\n${steps.join("\n")}`;
}
