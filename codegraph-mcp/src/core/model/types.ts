export type NodeType =
  | "FILE"
  | "MODULE"
  | "CLASS"
  | "INTERFACE"
  | "ENUM"
  | "FUNCTION"
  | "METHOD"
  | "VARIABLE"
  | "REST_ENDPOINT"
  | "REACT_COMPONENT"
  | "REACT_HOOK";

export type EdgeType =
  | "CONTAINS"
  | "IMPORTS"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "RENDERS"
  | "USES_HOOK";

export type ResolutionConfidence = "high" | "medium" | "low";

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  qualifiedName: string;
  file: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

/**
 * A reference discovered during parsing that has not yet been resolved to a
 * concrete node id (e.g. a method call, a JSX usage, a hook call). Resolution
 * happens in the graph-builder pass once the whole-project symbol index exists.
 */
export interface UnresolvedReference {
  /** qualifiedName of the symbol the reference occurs inside (the "from" node) */
  fromQualifiedName: string;
  /** simple or dotted name as written in source, e.g. "this.foo", "service.bar", "useLoan" */
  rawName: string;
  /** best-effort receiver type name if statically inferable (Java local var / field type) */
  receiverType?: string;
  kind: "call" | "jsx" | "hook";
  edgeType: EdgeType;
  line?: number;
}

export interface ParsedSymbol {
  type: NodeType;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  metadata?: Record<string, unknown>;
  /** qualifiedName of the enclosing symbol (file or class), used to build CONTAINS edges */
  parentQualifiedName: string;
}

export interface ParsedImport {
  /** raw import text, e.g. "com.example.loan.LoanRepository" or "./loanApi" */
  source: string;
  /** imported symbol name, if named import; undefined for wildcard/side-effect imports */
  importedName?: string;
  /** local alias used in the file, if different from importedName */
  localName?: string;
}

export interface ParsedFile {
  path: string;
  language: string;
  packageName?: string;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  references: UnresolvedReference[];
  /** EXTENDS/IMPLEMENTS style relations resolved by simple type name, resolved later against the index */
  typeRelations: Array<{
    fromQualifiedName: string;
    targetName: string;
    edgeType: "EXTENDS" | "IMPLEMENTS";
  }>;
  parseError?: string;
}
