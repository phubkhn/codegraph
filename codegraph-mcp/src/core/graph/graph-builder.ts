import posixPath from "node:path/posix";
import type { GraphEdge, GraphNode, NodeType, ParsedFile, ParsedSymbol, ResolutionConfidence, UnresolvedReference } from "../model/types.js";
import { ProjectIndex } from "./project-index.js";
import { resolveRelativeImport } from "./import-resolver.js";

export interface BuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Builds graph nodes/edges for a batch of newly-parsed files, resolving
 * references (calls, JSX renders, hook usage, extends/implements, imports)
 * against `existingIndex` — the full project index of nodes already
 * persisted from prior indexing runs, merged with the nodes produced here.
 * See docs in core model types.ts for the shapes involved.
 */
export function buildGraph(files: ParsedFile[], existingIndex: ProjectIndex): BuildResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const index = existingIndex; // mutated in place: new nodes get added as we go

  // Pass 1: create FILE nodes + symbol nodes, register them in the index.
  const fileNodeIdByPath = new Map<string, string>();
  for (const file of files) {
    const fileNode: GraphNode = {
      id: `FILE:${file.path}`,
      type: "FILE",
      name: posixPath.basename(file.path),
      qualifiedName: file.path,
      file: file.path,
    };
    nodes.push(fileNode);
    index.add(fileNode);
    fileNodeIdByPath.set(file.path, fileNode.id);
  }

  const symbolNodeBySymbol = new Map<ParsedSymbol, GraphNode>();
  for (const file of files) {
    for (const symbol of file.symbols) {
      const node: GraphNode = {
        id: nodeId(symbol, file.path),
        type: symbol.type,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        file: file.path,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        metadata: symbol.metadata,
      };
      nodes.push(node);
      index.add(node);
      symbolNodeBySymbol.set(symbol, node);
    }
  }

  // Pass 2: CONTAINS edges (file -> top-level symbol, class -> member).
  for (const file of files) {
    for (const symbol of file.symbols) {
      const childNode = symbolNodeBySymbol.get(symbol)!;
      let parentId: string | undefined;
      if (symbol.parentQualifiedName === file.path) {
        parentId = fileNodeIdByPath.get(file.path);
      } else {
        const parentCandidates = index.findByQualifiedName(symbol.parentQualifiedName).filter((n) => n.file === file.path);
        parentId = parentCandidates[0]?.id;
      }
      if (parentId) {
        edges.push(makeEdge(parentId, childNode.id, "CONTAINS"));
      }
    }
  }

  // Pass 3: IMPORTS edges.
  for (const file of files) {
    const fileNodeId = fileNodeIdByPath.get(file.path)!;
    for (const imp of file.imports) {
      if (imp.source.startsWith(".")) {
        const targetFile = resolveRelativeImport(file.path, imp.source, index.filePaths());
        if (targetFile) {
          const targetFileNode = index.findByQualifiedName(targetFile).find((n) => n.type === "FILE");
          if (targetFileNode) edges.push(makeEdge(fileNodeId, targetFileNode.id, "IMPORTS"));
        }
      } else if (imp.importedName) {
        const targets = index.findByQualifiedName(imp.source).filter((n) => ["CLASS", "INTERFACE", "ENUM"].includes(n.type));
        if (targets.length === 1) edges.push(makeEdge(fileNodeId, targets[0].id, "IMPORTS"));
      }
    }
  }

  // Pass 4: EXTENDS / IMPLEMENTS.
  for (const file of files) {
    for (const rel of file.typeRelations) {
      const fromCandidates = index.findByQualifiedName(rel.fromQualifiedName).filter((n) => n.file === file.path);
      const fromNode = fromCandidates[0];
      if (!fromNode) continue;
      const resolved = resolveJavaTypeSimpleName(rel.targetName, file, index);
      if (resolved) edges.push(makeEdge(fromNode.id, resolved.node.id, rel.edgeType, { confidence: resolved.confidence }));
    }
  }

  // Pass 5: references (CALLS / RENDERS / USES_HOOK).
  for (const file of files) {
    for (const ref of file.references) {
      const fromNode = resolveFromNode(ref, file, index);
      if (!fromNode) continue;
      const resolved = resolveReference(ref, file, index);
      if (!resolved) continue;
      edges.push(makeEdge(fromNode.id, resolved.node.id, ref.edgeType, { confidence: resolved.confidence }));
    }
  }

  return { nodes, edges };
}

function resolveFromNode(ref: UnresolvedReference, file: ParsedFile, index: ProjectIndex): GraphNode | undefined {
  return index.findByQualifiedName(ref.fromQualifiedName).find((n) => n.file === file.path) ?? index.findByQualifiedName(ref.fromQualifiedName)[0];
}

interface Resolution {
  node: GraphNode;
  confidence: ResolutionConfidence;
}

function resolveReference(ref: UnresolvedReference, file: ParsedFile, index: ProjectIndex): Resolution | undefined {
  // 0. Exact qualifiedName match — used for synthetic references (e.g. REST_ENDPOINT -> handler method)
  //    and any case where the raw name already is a fully-qualified symbol name.
  const exact = index.findByQualifiedName(ref.rawName);
  if (exact.length >= 1) return { node: exact[0], confidence: "high" };

  if (ref.kind === "jsx") return resolveByName(ref.rawName, file, index, ["REACT_COMPONENT", "FUNCTION"]);
  if (ref.kind === "hook") return resolveByName(ref.rawName, file, index, ["REACT_HOOK", "FUNCTION"]);

  // kind === "call"
  if (file.language === "java") return resolveJavaCall(ref, file, index);
  return resolveTsCall(ref, file, index);
}

function resolveByName(name: string, file: ParsedFile, index: ProjectIndex, types: NodeType[]): Resolution | undefined {
  // same-file first
  const sameFile = index.findInFile(file.path, name, types);
  if (sameFile.length === 1) return { node: sameFile[0], confidence: "high" };

  // import-based
  const imp = file.imports.find((i) => i.localName === name);
  if (imp) {
    const target = resolveImportedSymbol(imp, file, index, types);
    if (target) return target;
  }

  // global fallback, only if unambiguous
  const globalCandidates = index.findBySimpleName(name, types);
  if (globalCandidates.length === 1) return { node: globalCandidates[0], confidence: "medium" };
  return undefined;
}

function resolveImportedSymbol(
  imp: ParsedFile["imports"][number],
  file: ParsedFile,
  index: ProjectIndex,
  types: NodeType[],
): Resolution | undefined {
  if (!imp.source.startsWith(".")) return undefined;
  const targetFile = resolveRelativeImportFromKnown(file, imp, index);
  if (!targetFile) return undefined;

  if (imp.importedName && imp.importedName !== "default" && imp.importedName !== "*") {
    const named = index.findInFile(targetFile, imp.importedName, types);
    if (named.length === 1) return { node: named[0], confidence: "high" };
  }

  // default import or unresolved named export: fall back to the sole matching symbol in that file
  const candidatesInFile = index.findInFile(targetFile, imp.localName ?? "", types);
  if (candidatesInFile.length === 1) return { node: candidatesInFile[0], confidence: "high" };
  return undefined;
}

function resolveRelativeImportFromKnown(file: ParsedFile, imp: ParsedFile["imports"][number], index: ProjectIndex): string | undefined {
  return resolveRelativeImport(file.path, imp.source, index.filePaths());
}

function resolveJavaCall(ref: UnresolvedReference, file: ParsedFile, index: ProjectIndex): Resolution | undefined {
  const methodName = ref.rawName.includes(".") ? ref.rawName.split(".").pop()! : ref.rawName;

  let classNode: GraphNode | undefined;
  if (ref.receiverType) {
    const exactClass = index.findByQualifiedName(ref.receiverType).find((n) => ["CLASS", "INTERFACE", "ENUM"].includes(n.type));
    if (exactClass) {
      classNode = exactClass;
    } else {
      const resolved = resolveJavaTypeSimpleName(ref.receiverType, file, index);
      classNode = resolved?.node;
    }
  }

  if (classNode) {
    const method = index.findByQualifiedName(`${classNode.qualifiedName}.${methodName}`).find((n) => n.type === "METHOD");
    if (method) return { node: method, confidence: "high" };
  }

  const globalCandidates = index.findBySimpleName(methodName, ["METHOD", "FUNCTION"]);
  if (globalCandidates.length === 1) return { node: globalCandidates[0], confidence: "medium" };
  return undefined;
}

function resolveTsCall(ref: UnresolvedReference, file: ParsedFile, index: ProjectIndex): Resolution | undefined {
  const methodName = ref.rawName.includes(".") ? ref.rawName.split(".").pop()! : ref.rawName;
  const objectName = ref.rawName.includes(".") ? ref.rawName.split(".").slice(0, -1).join(".") : undefined;

  if (objectName === "this" || !objectName) {
    return resolveByName(methodName, file, index, ["FUNCTION", "METHOD", "REACT_HOOK", "REACT_COMPONENT"]);
  }

  if (ref.receiverType) {
    const classResolution = resolveTsTypeSimpleName(ref.receiverType, file, index);
    if (classResolution) {
      const method = index.findByQualifiedName(`${classResolution.node.qualifiedName}.${methodName}`).find((n) => n.type === "METHOD");
      if (method) return { node: method, confidence: "high" };
    }
  }

  const globalCandidates = index.findBySimpleName(methodName, ["METHOD", "FUNCTION"]);
  if (globalCandidates.length === 1) return { node: globalCandidates[0], confidence: "medium" };
  return undefined;
}

function resolveJavaTypeSimpleName(simpleName: string, file: ParsedFile, index: ProjectIndex): Resolution | undefined {
  const imp = file.imports.find((i) => i.importedName === simpleName);
  if (imp) {
    const target = index.findByQualifiedName(imp.source).find((n) => ["CLASS", "INTERFACE", "ENUM"].includes(n.type));
    if (target) return { node: target, confidence: "high" };
  }
  const sameFile = index.findInFile(file.path, simpleName, ["CLASS", "INTERFACE", "ENUM"]);
  if (sameFile.length === 1) return { node: sameFile[0], confidence: "high" };

  const global = index.findBySimpleName(simpleName, ["CLASS", "INTERFACE", "ENUM"]);
  if (global.length === 1) return { node: global[0], confidence: "medium" };
  return undefined;
}

function resolveTsTypeSimpleName(simpleName: string, file: ParsedFile, index: ProjectIndex): Resolution | undefined {
  const imp = file.imports.find((i) => i.importedName === simpleName || i.localName === simpleName);
  if (imp) {
    const targetFile = resolveRelativeImport(file.path, imp.source, index.filePaths());
    if (targetFile) {
      const target = index.findInFile(targetFile, simpleName, ["CLASS"]);
      if (target.length === 1) return { node: target[0], confidence: "high" };
    }
  }
  const sameFile = index.findInFile(file.path, simpleName, ["CLASS"]);
  if (sameFile.length === 1) return { node: sameFile[0], confidence: "high" };

  const global = index.findBySimpleName(simpleName, ["CLASS"]);
  if (global.length === 1) return { node: global[0], confidence: "medium" };
  return undefined;
}

function nodeId(symbol: ParsedSymbol, file: string): string {
  return `${symbol.type}:${symbol.qualifiedName}@${file}:${symbol.startLine}`;
}

function makeEdge(source: string, target: string, type: GraphEdge["type"], metadata?: Record<string, unknown>): GraphEdge {
  return { id: `${type}:${source}->${target}`, source, target, type, metadata };
}
