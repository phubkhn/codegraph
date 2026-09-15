import posixPath from "node:path/posix";
import type { ParsedFile, ParsedSymbol } from "../../core/model/types.js";

const HOOK_NAME_RE = /^use[A-Z0-9]/;
const COMPONENT_NAME_RE = /^[A-Z]/;
const TEST_FILE_RE = /\.(test|spec)\.(tsx?|jsx?)$/;

/**
 * Enriches a parsed TS/TSX file in place with React semantics: retypes
 * FUNCTION/METHOD symbols that look like components or hooks, detects
 * react-router `<Route>` usages, and maps test files to their subject by
 * naming convention — matching the same "core stays framework-agnostic,
 * semantic layer tags it" approach used for Spring in spring-tags.ts.
 */
export function applyReactTags(file: ParsedFile): void {
  for (const symbol of file.symbols) {
    if (symbol.type !== "FUNCTION" && symbol.type !== "METHOD") continue;
    const returnsJsx = Boolean(symbol.metadata?.returnsJsx);
    const usesHooks = Boolean(symbol.metadata?.usesHooks);

    if (HOOK_NAME_RE.test(symbol.name)) {
      symbol.type = "REACT_HOOK";
      symbol.metadata = { ...symbol.metadata, framework: "react" };
    } else if (COMPONENT_NAME_RE.test(symbol.name) && (returnsJsx || usesHooks)) {
      symbol.type = "REACT_COMPONENT";
      symbol.metadata = { ...symbol.metadata, framework: "react" };
    }
  }

  applyRouteTags(file);
  applyTestFileMapping(file);
}

/** react-router `<Route path="..." element={<X/>} />` (v6) / `<Route path="..." component={X} />` (v5). */
function applyRouteTags(file: ParsedFile): void {
  const extraSymbols: ParsedSymbol[] = [];
  const seenRoutes = new Set<string>();

  for (const ref of file.references) {
    if (ref.kind !== "jsx" || ref.rawName !== "Route" || !ref.attributes) continue;
    const path = ref.attributes.path;
    const componentName = ref.attributes.element ?? ref.attributes.component;
    if (!path || !componentName) continue;

    const routeQualifiedName = `ROUTE:${path}`;
    if (!seenRoutes.has(path)) {
      seenRoutes.add(path);
      extraSymbols.push({
        type: "ROUTE",
        name: path,
        qualifiedName: routeQualifiedName,
        startLine: ref.line ?? 1,
        endLine: ref.line ?? 1,
        parentQualifiedName: file.path,
        metadata: { framework: "react", path },
      });
    }

    file.references.push({
      fromQualifiedName: routeQualifiedName,
      rawName: componentName,
      kind: "jsx",
      edgeType: "RENDERS",
      line: ref.line,
    });
  }

  file.symbols.push(...extraSymbols);
}

/** `LoanForm.test.tsx` / `LoanForm.spec.ts` -> best-effort TESTED_BY on the FILE node itself
 *  (React/JS tests are `describe`/`it` blocks, not classes, so there's no single "test class" node
 *  the way there is on the Java side — the file stands in for it). */
function applyTestFileMapping(file: ParsedFile): void {
  const base = posixPath.basename(file.path);
  if (!TEST_FILE_RE.test(base)) return;
  const subjectName = base.replace(TEST_FILE_RE, "");
  if (!subjectName) return;

  file.typeRelations.push({
    fromQualifiedName: file.path,
    targetName: subjectName,
    edgeType: "TESTED_BY",
  });
}
