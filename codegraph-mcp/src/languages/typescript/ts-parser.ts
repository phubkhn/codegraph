import type { Node } from "web-tree-sitter";
import { createParser, type GrammarName } from "../../core/parser/tree-sitter-runtime.js";
import type { LanguageParser } from "../../core/parser/language-parser.js";
import type { ParsedFile, ParsedImport, ParsedSymbol, UnresolvedReference } from "../../core/model/types.js";
import { childrenByType, endLineOf, firstChildByType, lineOf, textOf } from "../../core/parser/ts-node-utils.js";

const HOOK_NAME_RE = /^use[A-Z0-9]/;

export class TypeScriptParser implements LanguageParser {
  readonly id = "typescript";

  supports(filePath: string): boolean {
    return /\.(tsx|ts|jsx|js)$/.test(filePath);
  }

  async parse(filePath: string, source: string): Promise<ParsedFile> {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];
    const references: UnresolvedReference[] = [];
    const typeRelations: ParsedFile["typeRelations"] = [];

    try {
      // Only bare `.ts` needs the plain grammar (its `<Type>value` cast syntax
      // is ambiguous with JSX). `.js`/`.jsx` can and very commonly do contain
      // JSX without a `.jsx`/`.tsx` extension (pre-TypeScript React code,
      // Babel-compiled projects) — the "typescript" grammar can't parse that
      // JSX at all, so such files silently got zero hook/JSX/RENDERS references.
      const grammar: GrammarName = filePath.endsWith(".ts") ? "typescript" : "tsx";
      const parser = await createParser(grammar);
      const tree = parser.parse(source);
      if (!tree) throw new Error("tree-sitter returned no parse tree");
      const root = tree.rootNode;

      for (const stmt of root.namedChildren) {
        if (!stmt) continue;
        handleTopLevel(stmt, source, filePath, symbols, imports, references);
      }
      collectRouterConfigCalls(root, filePath, references, source);

      return { path: filePath, language: "typescript", symbols, imports, references, typeRelations };
    } catch (err) {
      return {
        path: filePath,
        language: "typescript",
        symbols,
        imports,
        references,
        typeRelations,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function handleTopLevel(
  stmt: Node,
  source: string,
  filePath: string,
  symbols: ParsedSymbol[],
  imports: ParsedImport[],
  references: UnresolvedReference[],
): void {
  if (stmt.type === "import_statement") {
    handleImport(stmt, source, imports);
    return;
  }

  const decl = stmt.type === "export_statement" ? stmt.childForFieldName("declaration") : stmt;
  if (!decl) return; // e.g. `export { x }` / `export default someExpr` - nothing to index

  if (decl.type === "function_declaration") {
    handleFunction(decl, source, filePath, symbols, references);
  } else if (decl.type === "class_declaration") {
    handleClass(decl, source, filePath, symbols, references);
  } else if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
    for (const declarator of childrenByType(decl, "variable_declarator")) {
      const nameNode = declarator.childForFieldName("name");
      const valueNode = declarator.childForFieldName("value");
      if (!nameNode || nameNode.type !== "identifier") continue;
      const name = textOf(nameNode, source);
      const qualifiedName = `${filePath}::${name}`;
      if (valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
        pushFunctionSymbol(valueNode, name, qualifiedName, filePath, "module", symbols, references, source);
      } else {
        symbols.push({
          type: "VARIABLE",
          name,
          qualifiedName,
          startLine: lineOf(declarator),
          endLine: endLineOf(declarator),
          parentQualifiedName: filePath,
          metadata: { language: "typescript", kind: "module-variable" },
        });
      }
    }
  }
}

function handleImport(node: Node, source: string, imports: ParsedImport[]): void {
  const sourceNode = node.childForFieldName("source");
  const importSource = sourceNode ? stripQuotes(textOf(sourceNode, source)) : "";
  if (!importSource) return;

  const clause = firstChildByType(node, "import_clause");
  if (!clause) {
    imports.push({ source: importSource });
    return;
  }

  for (const child of clause.namedChildren) {
    if (!child) continue;
    if (child.type === "identifier") {
      imports.push({ source: importSource, importedName: "default", localName: textOf(child, source) });
    } else if (child.type === "named_imports") {
      for (const spec of childrenByType(child, "import_specifier")) {
        const nameNode = spec.childForFieldName("name");
        const aliasNode = spec.childForFieldName("alias");
        if (!nameNode) continue;
        const importedName = textOf(nameNode, source);
        imports.push({
          source: importSource,
          importedName,
          localName: aliasNode ? textOf(aliasNode, source) : importedName,
        });
      }
    } else if (child.type === "namespace_import") {
      const idNode = child.namedChild(0);
      imports.push({ source: importSource, importedName: "*", localName: idNode ? textOf(idNode, source) : undefined });
    }
  }
}

function handleFunction(
  node: Node,
  source: string,
  filePath: string,
  symbols: ParsedSymbol[],
  references: UnresolvedReference[],
): void {
  const nameNode = node.childForFieldName("name");
  const name = nameNode ? textOf(nameNode, source) : "default";
  const qualifiedName = `${filePath}::${name}`;
  pushFunctionSymbol(node, name, qualifiedName, filePath, "module", symbols, references, source);
}

function pushFunctionSymbol(
  fnNode: Node,
  name: string,
  qualifiedName: string,
  parentQualifiedName: string,
  scopeKind: "module" | "class",
  symbols: ParsedSymbol[],
  references: UnresolvedReference[],
  source: string,
): void {
  const body = fnNode.childForFieldName("body");
  const { returnsJsx, usesHooks } = body ? analyzeFunctionSignals(body) : { returnsJsx: false, usesHooks: false };

  symbols.push({
    type: "FUNCTION",
    name,
    qualifiedName,
    startLine: lineOf(fnNode),
    endLine: endLineOf(fnNode),
    parentQualifiedName,
    metadata: { language: "typescript", returnsJsx, usesHooks },
  });

  if (body) collectReferences(body, qualifiedName, references, source);
}

function handleClass(
  node: Node,
  source: string,
  filePath: string,
  symbols: ParsedSymbol[],
  references: UnresolvedReference[],
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const className = textOf(nameNode, source);
  const classQualifiedName = `${filePath}::${className}`;

  symbols.push({
    type: "CLASS",
    name: className,
    qualifiedName: classQualifiedName,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    parentQualifiedName: filePath,
    metadata: { language: "typescript" },
  });

  const body = node.childForFieldName("body");
  if (!body) return;

  const fieldTypes = new Map<string, string>();
  for (const member of body.namedChildren) {
    if (!member) continue;
    if (member.type === "public_field_definition") {
      const fNameNode = member.childForFieldName("name");
      const fTypeNode = member.childForFieldName("type");
      if (fNameNode && fTypeNode) {
        fieldTypes.set(textOf(fNameNode, source), textOf(fTypeNode, source).replace(/^:\s*/, "").split("<")[0].trim());
      }
    }
  }

  for (const member of body.namedChildren) {
    if (!member || member.type !== "method_definition") continue;
    const mNameNode = member.childForFieldName("name");
    if (!mNameNode) continue;
    const methodName = textOf(mNameNode, source);
    const methodQualifiedName = `${classQualifiedName}.${methodName}`;
    const mBody = member.childForFieldName("body");
    const { returnsJsx, usesHooks } = mBody ? analyzeFunctionSignals(mBody) : { returnsJsx: false, usesHooks: false };

    symbols.push({
      type: "METHOD",
      name: methodName,
      qualifiedName: methodQualifiedName,
      startLine: lineOf(member),
      endLine: endLineOf(member),
      parentQualifiedName: classQualifiedName,
      metadata: { language: "typescript", returnsJsx, usesHooks },
    });

    if (mBody) collectReferences(mBody, methodQualifiedName, references, source, fieldTypes);
  }
}

function analyzeFunctionSignals(body: Node): { returnsJsx: boolean; usesHooks: boolean } {
  const jsx = body.descendantsOfType(["jsx_element", "jsx_self_closing_element", "jsx_fragment"]);
  const calls = body.descendantsOfType(["call_expression"]);
  const usesHooks = calls.some((c) => {
    if (!c) return false;
    const fn = c.childForFieldName("function");
    const name = fn?.type === "identifier" ? fn.text : undefined;
    return !!name && HOOK_NAME_RE.test(name);
  });
  return { returnsJsx: jsx.length > 0, usesHooks };
}

function collectReferences(
  body: Node,
  fromQualifiedName: string,
  references: UnresolvedReference[],
  source: string,
  fieldTypes?: Map<string, string>,
): void {
  for (const call of body.descendantsOfType(["call_expression"])) {
    if (!call) continue;
    const fnNode = call.childForFieldName("function");
    if (!fnNode) continue;

    if (fnNode.type === "identifier") {
      const name = textOf(fnNode, source);
      const isHook = HOOK_NAME_RE.test(name);
      references.push({
        fromQualifiedName,
        rawName: name,
        kind: isHook ? "hook" : "call",
        edgeType: isHook ? "USES_HOOK" : "CALLS",
        line: lineOf(call),
      });
    } else if (fnNode.type === "member_expression") {
      const objectNode = fnNode.childForFieldName("object");
      const propertyNode = fnNode.childForFieldName("property");
      if (!objectNode || !propertyNode) continue;
      const property = textOf(propertyNode, source);
      if (objectNode.type === "identifier" || objectNode.type === "this") {
        const objectText = objectNode.type === "this" ? "this" : textOf(objectNode, source);
        const receiverType = objectNode.type === "this" ? undefined : fieldTypes?.get(objectText);
        references.push({
          fromQualifiedName,
          rawName: `${objectText}.${property}`,
          receiverType,
          kind: "call",
          edgeType: "CALLS",
          line: lineOf(call),
        });
      }
    }
  }

  for (const jsx of body.descendantsOfType(["jsx_element", "jsx_self_closing_element"])) {
    if (!jsx) continue;
    const opening = jsx.type === "jsx_self_closing_element" ? jsx : jsx.childForFieldName("open_tag");
    const nameNode = opening?.childForFieldName("name");
    if (!nameNode || !opening) continue;
    const tagName = textOf(nameNode, source);
    if (!/^[A-Z]/.test(tagName)) continue; // skip lowercase HTML elements
    references.push({
      fromQualifiedName,
      rawName: tagName,
      kind: "jsx",
      edgeType: "RENDERS",
      line: lineOf(jsx),
      attributes: extractJsxAttributes(opening, source),
    });
  }

  collectApiClientCalls(body, fromQualifiedName, references, source);
}

/** Attribute name -> best-effort value; for an `element`/`component`-style attribute whose value is
 *  itself a JSX tag, the inner tag's name is captured instead of raw source (used by react-router
 *  Route detection: `element={<LoanDetailPage />}` / `component={LoanDetailPage}`). */
function extractJsxAttributes(opening: Node, source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of opening.childrenForFieldName("attribute")) {
    if (!attr) continue;
    const nameNode = attr.namedChild(0);
    if (!nameNode) continue;
    const name = textOf(nameNode, source);
    const valueNode = attr.namedChild(1);
    if (!valueNode) {
      attrs[name] = "true";
    } else if (valueNode.type === "string") {
      attrs[name] = stripQuotes(textOf(valueNode, source));
    } else if (valueNode.type === "jsx_expression") {
      const inner = valueNode.namedChild(0);
      if (inner) attrs[name] = jsxOrIdentifierName(inner, source);
    }
  }
  return attrs;
}

/** Best-effort name for a JSX-or-plain-identifier value: a JSX tag's name, or the raw source text
 *  (capped) for anything else — used for `element`/`component` attribute/property values, which are
 *  either `<X/>` (JSX) or a bare component reference (identifier). */
function jsxOrIdentifierName(node: Node, source: string): string {
  if (node.type === "jsx_self_closing_element") {
    return textOf(node.childForFieldName("name"), source);
  }
  if (node.type === "jsx_element") {
    return textOf(node.childForFieldName("open_tag")?.childForFieldName("name"), source);
  }
  return textOf(node, source).slice(0, 200);
}

const ROUTER_FACTORY_NAMES = new Set(["createBrowserRouter", "createHashRouter", "createMemoryRouter"]);

/**
 * Detects react-router's v6.4+ data-router config style — `createBrowserRouter([{ path, element },
 * ...])`, including nested `children` arrays — and emits it as a synthetic `kind: "jsx", rawName:
 * "Route"` reference, the exact same shape the JSX `<Route path=... element=.../>` case produces, so
 * react-tags.ts's single `applyRouteTags` pass handles both styles with no extra logic. Runs over the
 * whole file root (not per-function) since this call is almost always at module top level. Only the
 * inline-array-literal argument is handled — a separately-declared `const routes = [...]` passed in
 * by reference isn't traced, and nested child paths aren't joined with their parent's path prefix.
 */
function collectRouterConfigCalls(root: Node, filePath: string, references: UnresolvedReference[], source: string): void {
  for (const call of root.descendantsOfType(["call_expression"])) {
    if (!call) continue;
    const fnNode = call.childForFieldName("function");
    if (!fnNode || fnNode.type !== "identifier" || !ROUTER_FACTORY_NAMES.has(textOf(fnNode, source))) continue;
    const routesArray = call.childForFieldName("arguments")?.namedChild(0);
    if (routesArray?.type === "array") collectRouteObjects(routesArray, filePath, references, source, lineOf(call));
  }
}

function collectRouteObjects(
  arrayNode: Node,
  filePath: string,
  references: UnresolvedReference[],
  source: string,
  line: number,
): void {
  for (const el of arrayNode.namedChildren) {
    if (!el || el.type !== "object") continue;
    let path: string | undefined;
    let componentName: string | undefined;
    let childrenArray: Node | undefined;

    for (const prop of el.namedChildren) {
      if (!prop || prop.type !== "pair") continue;
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");
      if (!keyNode || !valueNode) continue;
      const key = textOf(keyNode, source).replace(/['"]/g, "");
      if (key === "path" && valueNode.type === "string") {
        path = stripQuotes(textOf(valueNode, source));
      } else if (key === "element" || key === "Component" || key === "component") {
        componentName = jsxOrIdentifierName(valueNode, source);
      } else if (key === "children" && valueNode.type === "array") {
        childrenArray = valueNode;
      }
    }

    if (path && componentName) {
      references.push({
        fromQualifiedName: filePath,
        rawName: "Route",
        kind: "jsx",
        edgeType: "RENDERS",
        line,
        attributes: { path, element: componentName },
      });
    }
    if (childrenArray) collectRouteObjects(childrenArray, filePath, references, source, line);
  }
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Detects `fetch(url, {method})` and `xxx.get/post/put/patch/delete(url, ...)`-shaped calls (axios,
 * a custom api wrapper, etc. — no specific library name required) whose first argument is a string
 * or template literal that looks like a path, and emits a MAPS_TO_ENDPOINT reference targeting the
 * exact same `ENDPOINT:{METHOD} {path}` qualifiedName scheme the Java/Spring side uses for
 * REST_ENDPOINT nodes, so a frontend call and its backend handler converge on one shared node.
 */
function collectApiClientCalls(body: Node, fromQualifiedName: string, references: UnresolvedReference[], source: string): void {
  for (const call of body.descendantsOfType(["call_expression"])) {
    if (!call) continue;
    const fnNode = call.childForFieldName("function");
    if (!fnNode) continue;
    const argsList = call.childForFieldName("arguments");
    const firstArg = argsList?.namedChild(0);
    if (!firstArg) continue;
    const pathLiteral = stringOrTemplatePath(firstArg, source);
    if (!pathLiteral || !pathLiteral.startsWith("/")) continue;

    let httpMethod: string | undefined;
    if (fnNode.type === "identifier" && textOf(fnNode, source) === "fetch") {
      const optionsArg = argsList?.namedChild(1);
      httpMethod = extractFetchMethod(optionsArg, source) ?? "GET";
    } else if (fnNode.type === "member_expression") {
      const property = textOf(fnNode.childForFieldName("property"), source).toLowerCase();
      if (HTTP_METHODS.has(property)) httpMethod = property.toUpperCase();
    }
    if (!httpMethod) continue;

    const path = normalizeTemplateParams(pathLiteral);
    references.push({
      fromQualifiedName,
      rawName: `ENDPOINT:${httpMethod} ${path}`,
      kind: "call",
      edgeType: "MAPS_TO_ENDPOINT",
      line: lineOf(call),
      attributes: { httpMethod, path },
    });
  }
}

/**
 * String literal or template literal text with `${...}` interpolations replaced by `{param}`, e.g.
 * `/api/loans/${id}` -> `/api/loans/{param}`. A *leading* substitution (`${API_BASE_URL}/api/loans`)
 * is dropped entirely rather than turned into `{param}` — in practice that position is always a base
 * URL prefix built at runtime (env var, config value), never a path segment, so keeping it as a
 * literal `{param}` would make the path never match the backend's real route.
 */
function stringOrTemplatePath(node: Node, source: string): string | undefined {
  if (node.type === "string") return stripQuotes(textOf(node, source));
  if (node.type === "template_string") {
    const children = node.namedChildren;
    const startIndex = children[0]?.type === "template_substitution" ? 1 : 0;
    return children
      .slice(startIndex)
      .map((c) => (c && c.type === "template_substitution" ? "{param}" : c ? textOf(c, source) : ""))
      .join("")
      .replace(/`/g, "");
  }
  return undefined;
}

function normalizeTemplateParams(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg === "{param}" || /^[:{].*[}]?$/.test(seg) ? "{param}" : seg))
    .join("/");
}

function extractFetchMethod(optionsArg: Node | null | undefined, source: string): string | undefined {
  if (!optionsArg || optionsArg.type !== "object") return undefined;
  for (const prop of optionsArg.namedChildren) {
    if (!prop || prop.type !== "pair") continue;
    const keyNode = prop.childForFieldName("key");
    if (!keyNode || textOf(keyNode, source).replace(/['"]/g, "") !== "method") continue;
    const valueNode = prop.childForFieldName("value");
    if (valueNode?.type === "string") return stripQuotes(textOf(valueNode, source)).toUpperCase();
  }
  return undefined;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}
