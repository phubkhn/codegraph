import type { Node } from "web-tree-sitter";
import { createParser } from "../../core/parser/tree-sitter-runtime.js";
import type { LanguageParser } from "../../core/parser/language-parser.js";
import type { ParsedFile, ParsedImport, ParsedSymbol, UnresolvedReference } from "../../core/model/types.js";
import { childrenByType, endLineOf, firstChildByType, lineOf, simpleTypeName, textOf } from "../../core/parser/ts-node-utils.js";

export interface AnnotationInfo {
  name: string;
  /** value of a single unnamed string argument, e.g. @RequestMapping("/api/loans") */
  stringArg?: string;
  /** named element-value pairs, e.g. @RequestMapping(value = "/x", method = RequestMethod.GET) */
  pairs?: Record<string, string>;
}

const TYPE_DECL_TYPES = ["class_declaration", "interface_declaration", "enum_declaration"];

export class JavaParser implements LanguageParser {
  readonly id = "java";

  supports(filePath: string): boolean {
    return filePath.endsWith(".java");
  }

  async parse(filePath: string, source: string): Promise<ParsedFile> {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];
    const references: UnresolvedReference[] = [];
    const typeRelations: ParsedFile["typeRelations"] = [];

    try {
      const parser = await createParser("java");
      const tree = parser.parse(source);
      if (!tree) throw new Error("tree-sitter returned no parse tree");
      const root = tree.rootNode;

      const packageDecl = firstChildByType(root, "package_declaration");
      const packageName = packageDecl ? textOf(packageDecl.namedChild(0), source) : undefined;

      for (const importDecl of childrenByType(root, "import_declaration")) {
        const scoped = importDecl.namedChildren.find((c) => c && c.type !== "asterisk");
        const hasWildcard = importDecl.namedChildren.some((c) => c && c.type === "asterisk");
        if (!scoped) continue;
        const fullPath = textOf(scoped, source);
        const parts = fullPath.split(".");
        imports.push({
          source: fullPath,
          importedName: hasWildcard ? undefined : parts[parts.length - 1],
        });
      }

      for (const typeDecl of root.namedChildren) {
        if (!typeDecl || !TYPE_DECL_TYPES.includes(typeDecl.type)) continue;
        walkTypeDeclaration(typeDecl, source, filePath, packageName, [], symbols, references, typeRelations);
      }

      return { path: filePath, language: "java", packageName, symbols, imports, references, typeRelations };
    } catch (err) {
      return {
        path: filePath,
        language: "java",
        symbols,
        imports,
        references,
        typeRelations,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function walkTypeDeclaration(
  node: Node,
  source: string,
  filePath: string,
  packageName: string | undefined,
  enclosingNames: string[],
  symbols: ParsedSymbol[],
  references: UnresolvedReference[],
  typeRelations: ParsedFile["typeRelations"],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const simpleName = textOf(nameNode, source);
  const qualifiedName = buildQualifiedName(packageName, [...enclosingNames, simpleName]);
  const parentQualifiedName =
    enclosingNames.length > 0 ? buildQualifiedName(packageName, enclosingNames) : filePath;

  const nodeType = node.type === "interface_declaration" ? "INTERFACE" : node.type === "enum_declaration" ? "ENUM" : "CLASS";
  const annotations = extractAnnotations(node, source);

  symbols.push({
    type: nodeType,
    name: simpleName,
    qualifiedName,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    parentQualifiedName,
    metadata: { language: "java", annotations, modifiers: extractModifierKeywords(node, source) },
  });

  const superclass = node.childForFieldName("superclass");
  if (superclass) {
    const typeId = superclass.namedChild(0);
    const targetName = simpleTypeName(typeId, source);
    if (targetName) typeRelations.push({ fromQualifiedName: qualifiedName, targetName, edgeType: "EXTENDS" });
  }

  const interfacesField = node.childForFieldName("interfaces");
  if (interfacesField) {
    const typeList = firstChildByType(interfacesField, "type_list") ?? interfacesField;
    for (const t of typeList.namedChildren) {
      const targetName = simpleTypeName(t, source);
      if (targetName) typeRelations.push({ fromQualifiedName: qualifiedName, targetName, edgeType: "IMPLEMENTS" });
    }
  }

  // interface extends interface(s), e.g. `interface LoanRepository extends JpaRepository<Loan, Long>`
  const extendsInterfaces = firstChildByType(node, "extends_interfaces");
  if (extendsInterfaces) {
    const typeList = firstChildByType(extendsInterfaces, "type_list") ?? extendsInterfaces;
    for (const t of typeList.namedChildren) {
      const targetName = simpleTypeName(t, source);
      if (targetName) typeRelations.push({ fromQualifiedName: qualifiedName, targetName, edgeType: "EXTENDS" });
    }
  }

  const body = node.childForFieldName("body");
  if (!body) return;

  for (const member of body.namedChildren) {
    if (!member) continue;
    if (TYPE_DECL_TYPES.includes(member.type)) {
      walkTypeDeclaration(member, source, filePath, packageName, [...enclosingNames, simpleName], symbols, references, typeRelations);
      continue;
    }
    if (member.type === "field_declaration") {
      handleFieldDeclaration(member, source, qualifiedName, symbols);
      continue;
    }
    if (member.type === "method_declaration" || member.type === "constructor_declaration") {
      handleMethodDeclaration(member, source, qualifiedName, symbols, references);
      continue;
    }
  }
}

function handleFieldDeclaration(node: Node, source: string, classQualifiedName: string, symbols: ParsedSymbol[]): void {
  const typeNode = node.childForFieldName("type");
  const declaredType = simpleTypeName(typeNode, source);
  for (const declarator of childrenByType(node, "variable_declarator")) {
    const nameNode = declarator.childForFieldName("name");
    if (!nameNode) continue;
    const fieldName = textOf(nameNode, source);
    symbols.push({
      type: "VARIABLE",
      name: fieldName,
      qualifiedName: `${classQualifiedName}.${fieldName}`,
      startLine: lineOf(node),
      endLine: endLineOf(node),
      parentQualifiedName: classQualifiedName,
      metadata: { language: "java", declaredType, kind: "field" },
    });
  }
}

function handleMethodDeclaration(
  node: Node,
  source: string,
  classQualifiedName: string,
  symbols: ParsedSymbol[],
  references: UnresolvedReference[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const methodName = textOf(nameNode, source);
  const methodQualifiedName = `${classQualifiedName}.${methodName}`;
  const annotations = extractAnnotations(node, source);

  symbols.push({
    type: "METHOD",
    name: methodName,
    qualifiedName: methodQualifiedName,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    parentQualifiedName: classQualifiedName,
    metadata: { language: "java", annotations, modifiers: extractModifierKeywords(node, source) },
  });

  // local scope: parameter/local-var name -> declared type simple name
  const localTypes = new Map<string, string>();
  const params = node.childForFieldName("parameters");
  if (params) {
    for (const p of childrenByType(params, "formal_parameter")) {
      const pType = simpleTypeName(p.childForFieldName("type"), source);
      const pNameNode = p.childForFieldName("name");
      if (pType && pNameNode) localTypes.set(textOf(pNameNode, source), pType);
    }
  }

  const body = node.childForFieldName("body");
  if (!body) return;

  for (const localDecl of body.descendantsOfType("local_variable_declaration")) {
    if (!localDecl) continue;
    const declType = simpleTypeName(localDecl.childForFieldName("type"), source);
    if (!declType) continue;
    for (const declarator of childrenByType(localDecl, "variable_declarator")) {
      const n = declarator.childForFieldName("name");
      if (n) localTypes.set(textOf(n, source), declType);
    }
  }

  for (const invocation of body.descendantsOfType("method_invocation")) {
    if (!invocation) continue;
    const invName = invocation.childForFieldName("name");
    if (!invName) continue;
    const calledMethod = textOf(invName, source);
    const objectNode = invocation.childForFieldName("object");

    let receiverType: string | undefined;
    let rawName = calledMethod;

    if (!objectNode) {
      receiverType = classQualifiedName;
    } else if (objectNode.type === "this") {
      receiverType = classQualifiedName;
      rawName = `this.${calledMethod}`;
    } else if (objectNode.type === "identifier") {
      const objName = textOf(objectNode, source);
      rawName = `${objName}.${calledMethod}`;
      receiverType = localTypes.get(objName) ?? findFieldType(symbols, classQualifiedName, objName);
      if (!receiverType) receiverType = objName; // could be a static class reference
    } else {
      rawName = calledMethod;
    }

    references.push({
      fromQualifiedName: methodQualifiedName,
      rawName,
      receiverType,
      kind: "call",
      edgeType: "CALLS",
      line: lineOf(invocation),
    });
  }
}

function findFieldType(symbols: ParsedSymbol[], classQualifiedName: string, fieldName: string): string | undefined {
  const field = symbols.find(
    (s) => s.type === "VARIABLE" && s.parentQualifiedName === classQualifiedName && s.name === fieldName,
  );
  return field?.metadata?.declaredType as string | undefined;
}

function extractModifierKeywords(node: Node, source: string): string[] {
  const modifiers = firstChildByType(node, "modifiers");
  if (!modifiers) return [];
  return modifiers.children
    .filter((c): c is Node => !!c && !c.type.includes("annotation") && c.isNamed === false)
    .map((c) => textOf(c, source))
    .filter(Boolean);
}

function extractAnnotations(node: Node, source: string): AnnotationInfo[] {
  const modifiers = firstChildByType(node, "modifiers");
  if (!modifiers) return [];
  const result: AnnotationInfo[] = [];
  for (const ann of modifiers.namedChildren) {
    if (!ann || (ann.type !== "annotation" && ann.type !== "marker_annotation")) continue;
    const nameNode = ann.childForFieldName("name");
    const name = textOf(nameNode, source);
    const info: AnnotationInfo = { name };
    const argsList = ann.childForFieldName("arguments");
    if (argsList) {
      for (const arg of argsList.namedChildren) {
        if (!arg) continue;
        if (arg.type === "string_literal") {
          info.stringArg = stripQuotes(textOf(arg, source));
        } else if (arg.type === "element_value_pair") {
          const key = textOf(arg.childForFieldName("key"), source);
          const value = arg.childForFieldName("value");
          if (!info.pairs) info.pairs = {};
          info.pairs[key] = value?.type === "string_literal" ? stripQuotes(textOf(value, source)) : textOf(value, source);
        }
      }
    }
    result.push(info);
  }
  return result;
}

function stripQuotes(s: string): string {
  return s.replace(/^"|"$/g, "");
}

function buildQualifiedName(packageName: string | undefined, names: string[]): string {
  const joined = names.join(".");
  return packageName ? `${packageName}.${joined}` : joined;
}
