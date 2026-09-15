import posixPath from "node:path/posix";
import type { GraphEdge, GraphNode, NodeType, ParsedFile, ParsedSymbol, ResolutionConfidence, UnresolvedReference } from "../model/types.js";
import { ProjectIndex } from "./project-index.js";
import { resolveRelativeImport } from "./import-resolver.js";

/** @Entity classes get retyped to ENTITY by spring-tags, so type-name resolution must still match them. */
const JAVA_TYPE_NODE_TYPES: NodeType[] = ["CLASS", "INTERFACE", "ENUM", "ENTITY"];

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
        const targets = index.findByQualifiedName(imp.source).filter((n) => JAVA_TYPE_NODE_TYPES.includes(n.type));
        if (targets.length === 1) edges.push(makeEdge(fileNodeId, targets[0].id, "IMPORTS"));
      }
    }
  }

  // Pass 4: EXTENDS / IMPLEMENTS / DEPENDS_ON / TESTED_BY (type-name-based relations).
  for (const file of files) {
    for (const rel of file.typeRelations) {
      const fromCandidates = index.findByQualifiedName(rel.fromQualifiedName).filter((n) => n.file === file.path);
      const fromNode = fromCandidates[0];
      if (!fromNode) continue;
      const resolved =
        file.language === "java"
          ? resolveJavaTypeSimpleName(rel.targetName, file, index)
          : resolveTsTypeSimpleName(rel.targetName, file, index, TS_SYMBOL_NODE_TYPES);
      if (!resolved) continue;
      const metadata = { confidence: resolved.confidence, ...rel.metadata };
      // TESTED_BY is declared from the (in-file) test class pointing at its (name-resolved,
      // usually cross-file) subject, but the edge itself should read Subject -[TESTED_BY]-> Test.
      if (rel.edgeType === "TESTED_BY") {
        edges.push(makeEdge(resolved.node.id, fromNode.id, "TESTED_BY", metadata));
      } else {
        edges.push(makeEdge(fromNode.id, resolved.node.id, rel.edgeType, metadata));
      }
    }
  }

  // Pass 5: references (CALLS / RENDERS / USES_HOOK / PRODUCES / CONSUMES / MAPS_TO_ENDPOINT).
  for (const file of files) {
    for (const ref of file.references) {
      const fromNode = resolveFromNode(ref, file, index);
      if (!fromNode) continue;
      const resolved = resolveReference(ref, file, index);
      if (!resolved) continue;
      edges.push(makeEdge(fromNode.id, resolved.node.id, ref.edgeType, { confidence: resolved.confidence, ...refEdgeMetadata(ref) }));
    }
  }

  return { nodes, edges };
}

function resolveFromNode(ref: UnresolvedReference, file: ParsedFile, index: ProjectIndex): GraphNode | undefined {
  return index.findByQualifiedName(ref.fromQualifiedName).find((n) => n.file === file.path) ?? index.findByQualifiedName(ref.fromQualifiedName)[0];
}

/** Reference-kind-specific extra edge metadata: prop names for RENDERS, http method/path for MAPS_TO_ENDPOINT. */
function refEdgeMetadata(ref: UnresolvedReference): Record<string, unknown> {
  if (ref.edgeType === "RENDERS" && ref.attributes) {
    return { props: Object.keys(ref.attributes) };
  }
  if (ref.edgeType === "MAPS_TO_ENDPOINT" && ref.attributes) {
    return { httpMethod: ref.attributes.httpMethod, path: ref.attributes.path };
  }
  return {};
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
    const exactClass = index.findByQualifiedName(ref.receiverType).find((n) => JAVA_TYPE_NODE_TYPES.includes(n.type));
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
    const target = index.findByQualifiedName(imp.source).find((n) => JAVA_TYPE_NODE_TYPES.includes(n.type));
    if (target) return { node: target, confidence: "high" };
  }
  const sameFile = index.findInFile(file.path, simpleName, JAVA_TYPE_NODE_TYPES);
  if (sameFile.length === 1) return { node: sameFile[0], confidence: "high" };

  // same package, no explicit import needed in Java
  if (file.packageName) {
    const samePackage = index
      .findByQualifiedName(`${file.packageName}.${simpleName}`)
      .filter((n) => JAVA_TYPE_NODE_TYPES.includes(n.type));
    if (samePackage.length === 1) return { node: samePackage[0], confidence: "high" };
  }

  const global = index.findBySimpleName(simpleName, JAVA_TYPE_NODE_TYPES);
  if (global.length === 1) return { node: global[0], confidence: "medium" };
  return undefined;
}

const TS_DEFAULT_TYPE_NODE_TYPES: NodeType[] = ["CLASS"];
/** Broader pool used for by-name TS subject resolution where the target may not be a class (e.g. TESTED_BY -> a component/function/hook). */
const TS_SYMBOL_NODE_TYPES: NodeType[] = ["CLASS", "FUNCTION", "REACT_COMPONENT", "REACT_HOOK"];

function resolveTsTypeSimpleName(
  simpleName: string,
  file: ParsedFile,
  index: ProjectIndex,
  types: NodeType[] = TS_DEFAULT_TYPE_NODE_TYPES,
): Resolution | undefined {
  const imp = file.imports.find((i) => i.importedName === simpleName || i.localName === simpleName);
  if (imp) {
    const targetFile = resolveRelativeImport(file.path, imp.source, index.filePaths());
    if (targetFile) {
      const target = index.findInFile(targetFile, simpleName, types);
      if (target.length === 1) return { node: target[0], confidence: "high" };
    }
  }
  const sameFile = index.findInFile(file.path, simpleName, types);
  if (sameFile.length === 1) return { node: sameFile[0], confidence: "high" };

  const global = index.findBySimpleName(simpleName, types);
  if (global.length === 1) return { node: global[0], confidence: "medium" };
  return undefined;
}

/** Node types whose qualifiedName is a globally shared, synthetic identity (REST endpoints, Kafka
 *  topics) rather than something declared once in exactly one place — their id must stay stable
 *  across files/re-indexes so producer/consumer or route/handler edges from different files converge
 *  on the same node instead of creating duplicates. */
const SHARED_IDENTITY_NODE_TYPES: NodeType[] = ["REST_ENDPOINT", "KAFKA_TOPIC", "ROUTE"];

function nodeId(symbol: ParsedSymbol, file: string): string {
  if (SHARED_IDENTITY_NODE_TYPES.includes(symbol.type)) return `${symbol.type}:${symbol.qualifiedName}`;
  return `${symbol.type}:${symbol.qualifiedName}@${file}:${symbol.startLine}`;
}

function makeEdge(source: string, target: string, type: GraphEdge["type"], metadata?: Record<string, unknown>): GraphEdge {
  return { id: `${type}:${source}->${target}`, source, target, type, metadata };
}
