import type { ParsedFile } from "../../core/model/types.js";

const HOOK_NAME_RE = /^use[A-Z0-9]/;
const COMPONENT_NAME_RE = /^[A-Z]/;

/**
 * Enriches a parsed TS/TSX file in place with React semantics: retypes
 * FUNCTION/METHOD symbols that look like components or hooks, matching the
 * same "core stays framework-agnostic, semantic layer tags it" approach used
 * for Spring in spring-tags.ts.
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
}
