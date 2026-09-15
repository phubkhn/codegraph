import type { GraphNode, NodeType } from "../model/types.js";

/** In-memory lookup index over the current set of graph nodes, used to resolve references. */
export class ProjectIndex {
  private readonly byId = new Map<string, GraphNode>();
  private readonly byQualifiedName = new Map<string, GraphNode[]>();
  private readonly bySimpleName = new Map<string, GraphNode[]>();
  private readonly byFile = new Map<string, GraphNode[]>();
  private readonly filePathSet = new Set<string>();

  add(node: GraphNode): void {
    this.byId.set(node.id, node);
    pushInto(this.byQualifiedName, node.qualifiedName, node);
    pushInto(this.bySimpleName, node.name, node);
    pushInto(this.byFile, node.file, node);
    if (node.type === "FILE") this.filePathSet.add(node.qualifiedName);
  }

  addAll(nodes: GraphNode[]): void {
    for (const n of nodes) this.add(n);
  }

  get(id: string): GraphNode | undefined {
    return this.byId.get(id);
  }

  findByQualifiedName(qualifiedName: string): GraphNode[] {
    return this.byQualifiedName.get(qualifiedName) ?? [];
  }

  findBySimpleName(name: string, types?: NodeType[]): GraphNode[] {
    const candidates = this.bySimpleName.get(name) ?? [];
    return types ? candidates.filter((c) => types.includes(c.type)) : candidates;
  }

  findInFile(file: string, name: string, types?: NodeType[]): GraphNode[] {
    const candidates = (this.byFile.get(file) ?? []).filter((n) => n.name === name);
    return types ? candidates.filter((c) => types.includes(c.type)) : candidates;
  }

  /** All project-relative file paths known to this index (i.e. every FILE node registered so far). */
  filePaths(): Set<string> {
    return this.filePathSet;
  }
}

function pushInto<K>(map: Map<K, GraphNode[]>, key: K, node: GraphNode): void {
  const arr = map.get(key);
  if (arr) arr.push(node);
  else map.set(key, [node]);
}
