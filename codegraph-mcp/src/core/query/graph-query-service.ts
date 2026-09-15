import type { SqliteGraphStore } from "../storage/sqlite-store.js";
import type { EdgeType, GraphEdge, GraphNode } from "../model/types.js";

const FLOW_EDGE_TYPES: EdgeType[] = [
  "CALLS",
  "EXTENDS",
  "IMPLEMENTS",
  "RENDERS",
  "USES_HOOK",
  "DEPENDS_ON",
  "PRODUCES",
  "CONSUMES",
  "TESTED_BY",
];

export interface QueryLimits {
  maxDepth: number;
  maxNodes: number;
}

export interface PathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ImpactResult {
  root: GraphNode;
  affected: Array<{ node: GraphNode; depth: number; via: GraphEdge }>;
  truncated: boolean;
}

export class GraphQueryService {
  constructor(
    private readonly store: SqliteGraphStore,
    private readonly limits: QueryLimits,
  ) {}

  searchSymbols(query: string, limit = 25): GraphNode[] {
    return this.store.searchSymbols(query, limit);
  }

  getNode(id: string): GraphNode | undefined {
    return this.store.getNode(id);
  }

  /** Resolves a user-supplied symbol query (id, qualifiedName, or fuzzy name) to the best-matching node. */
  resolveSymbol(query: string): GraphNode | undefined {
    const byQualified = this.store.getNodesByQualifiedName(query);
    if (byQualified.length > 0) return byQualified[0];
    const byId = this.store.getNode(query);
    if (byId) return byId;
    const search = this.store.searchSymbols(query, 1);
    return search[0];
  }

  getCallers(nodeId: string): GraphNode[] {
    return this.store.getEdgesTo(nodeId, ["CALLS"]).map((e) => this.store.getNode(e.source)).filter((n): n is GraphNode => !!n);
  }

  getCallees(nodeId: string): GraphNode[] {
    return this.store.getEdgesFrom(nodeId, ["CALLS"]).map((e) => this.store.getNode(e.target)).filter((n): n is GraphNode => !!n);
  }

  getDependents(nodeId: string): GraphNode[] {
    return this.store
      .getEdgesTo(nodeId, FLOW_EDGE_TYPES)
      .map((e) => this.store.getNode(e.source))
      .filter((n): n is GraphNode => !!n);
  }

  getDependencies(nodeId: string): GraphNode[] {
    return this.store
      .getEdgesFrom(nodeId, FLOW_EDGE_TYPES)
      .map((e) => this.store.getNode(e.target))
      .filter((n): n is GraphNode => !!n);
  }

  /** Outgoing flow edges (CALLS/EXTENDS/IMPLEMENTS/RENDERS/USES_HOOK) paired with their edge type, for grouping by relationship. */
  getOutgoingByType(nodeId: string): Array<{ edgeType: EdgeType; node: GraphNode }> {
    return this.store
      .getEdgesFrom(nodeId, FLOW_EDGE_TYPES)
      .map((e) => ({ edgeType: e.type, node: this.store.getNode(e.target) }))
      .filter((r): r is { edgeType: EdgeType; node: GraphNode } => !!r.node);
  }

  /** Incoming flow edges (CALLS/EXTENDS/IMPLEMENTS/RENDERS/USES_HOOK) paired with their edge type. */
  getIncomingByType(nodeId: string): Array<{ edgeType: EdgeType; node: GraphNode }> {
    return this.store
      .getEdgesTo(nodeId, FLOW_EDGE_TYPES)
      .map((e) => ({ edgeType: e.type, node: this.store.getNode(e.source) }))
      .filter((r): r is { edgeType: EdgeType; node: GraphNode } => !!r.node);
  }

  findPath(fromId: string, toId: string, maxDepth = this.limits.maxDepth): PathResult | undefined {
    if (fromId === toId) {
      const n = this.store.getNode(fromId);
      return n ? { nodes: [n], edges: [] } : undefined;
    }
    const visited = new Set<string>([fromId]);
    const queue: string[] = [fromId];
    const cameFrom = new Map<string, { via: GraphEdge; from: string }>();
    let depth = 0;

    while (queue.length > 0 && depth < maxDepth) {
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;
        for (const edge of this.store.getEdgesFrom(current, FLOW_EDGE_TYPES)) {
          if (visited.has(edge.target)) continue;
          visited.add(edge.target);
          cameFrom.set(edge.target, { via: edge, from: current });
          if (edge.target === toId) {
            return this.reconstructPath(fromId, toId, cameFrom);
          }
          queue.push(edge.target);
        }
      }
      depth++;
    }
    return undefined;
  }

  private reconstructPath(fromId: string, toId: string, cameFrom: Map<string, { via: GraphEdge; from: string }>): PathResult {
    const edges: GraphEdge[] = [];
    const nodeIds: string[] = [toId];
    let cursor = toId;
    while (cursor !== fromId) {
      const step = cameFrom.get(cursor);
      if (!step) break;
      edges.unshift(step.via);
      cursor = step.from;
      nodeIds.unshift(cursor);
    }
    const nodes = nodeIds.map((id) => this.store.getNode(id)).filter((n): n is GraphNode => !!n);
    return { nodes, edges };
  }

  /** BFS over reverse flow edges: everything that (transitively) depends on `nodeId`. */
  impactAnalysis(nodeId: string, maxDepth = this.limits.maxDepth): ImpactResult | undefined {
    const root = this.store.getNode(nodeId);
    if (!root) return undefined;

    const affected: ImpactResult["affected"] = [];
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    let depth = 0;
    let truncated = false;

    while (frontier.length > 0 && depth < maxDepth) {
      depth++;
      const next: string[] = [];
      for (const current of frontier) {
        for (const edge of this.store.getEdgesTo(current, FLOW_EDGE_TYPES)) {
          if (visited.has(edge.source)) continue;
          if (affected.length >= this.limits.maxNodes) {
            truncated = true;
            continue;
          }
          visited.add(edge.source);
          const node = this.store.getNode(edge.source);
          if (!node) continue;
          affected.push({ node, depth, via: edge });
          next.push(edge.source);
        }
      }
      frontier = next;
    }

    return { root, affected, truncated };
  }

  getStatus() {
    return this.store.getStatus();
  }
}
