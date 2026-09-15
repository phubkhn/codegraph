import type { Node } from "web-tree-sitter";

export function textOf(node: Node | null | undefined, source: string): string {
  if (!node) return "";
  return source.slice(node.startIndex, node.endIndex);
}

export function childrenByType(node: Node, type: string): Node[] {
  return node.namedChildren.filter((c): c is Node => !!c && c.type === type);
}

export function firstChildByType(node: Node, type: string): Node | null {
  return node.namedChildren.find((c): c is Node => !!c && c.type === type) ?? null;
}

/** Reduces a type node (possibly generic/array/scoped) to its base simple name, e.g. List<Loan> -> List, com.foo.Bar -> Bar */
export function simpleTypeName(typeNode: Node | null | undefined, source: string): string | undefined {
  if (!typeNode) return undefined;
  switch (typeNode.type) {
    case "generic_type":
      return simpleTypeName(typeNode.namedChild(0), source);
    case "array_type":
      return simpleTypeName(typeNode.childForFieldName("element") ?? typeNode.namedChild(0), source);
    case "scoped_type_identifier": {
      const text = textOf(typeNode, source);
      const parts = text.split(".");
      return parts[parts.length - 1];
    }
    case "type_identifier":
    case "identifier":
      return textOf(typeNode, source);
    default:
      return textOf(typeNode, source);
  }
}

export function lineOf(node: Node): number {
  return node.startPosition.row + 1;
}

export function endLineOf(node: Node): number {
  return node.endPosition.row + 1;
}
