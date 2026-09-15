import type { ParsedFile } from "../../core/model/types.js";
import type { AnnotationInfo } from "./java-parser.js";
import { configPropertyQualifiedName } from "../config/property-key.js";

/** `${key}` or `${key:default}` inside a `@Value("...")` string argument. */
const PLACEHOLDER_RE = /^\$\{([^}:]+)(?::[^}]*)?\}$/;

/**
 * Emits a DEPENDS_ON reference from a `@Value("${key}")` field (or, via
 * `@ConfigurationProperties(prefix = "x")`, every field of that class as
 * `x.fieldName`) to the CONFIG_PROPERTY node the properties/YAML parser
 * creates for that key — the same "synthetic reference with an exact
 * qualifiedName" mechanism spring-tags.ts already uses to wire a
 * REST_ENDPOINT to its handler method, so no resolver changes are needed.
 * Without this, `@Value`-injected config never shows up as a dependency:
 * `code_impact` on a property key looks like nothing uses it.
 */
export function applyConfigBindingTags(file: ParsedFile): void {
  const fields = file.symbols.filter((s) => s.type === "VARIABLE" && s.metadata?.kind === "field");

  for (const field of fields) {
    const annotations = (field.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
    const valueAnn = annotations.find((a) => a.name === "Value");
    if (!valueAnn) continue;
    const raw = valueAnn.stringArg ?? valueAnn.pairs?.value;
    if (!raw) continue;
    const match = raw.match(PLACEHOLDER_RE);
    if (!match) continue; // a literal default with no placeholder, e.g. @Value("5") — nothing to bind

    file.references.push({
      fromQualifiedName: field.qualifiedName,
      rawName: configPropertyQualifiedName(match[1]!),
      kind: "call",
      edgeType: "DEPENDS_ON",
      line: field.startLine,
      attributes: { via: "config-binding" },
    });
  }

  const classes = file.symbols.filter((s) => s.type === "CLASS" || s.type === "ENTITY");
  for (const cls of classes) {
    const classAnns = (cls.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
    const cfgAnn = classAnns.find((a) => a.name === "ConfigurationProperties");
    if (!cfgAnn) continue;
    const prefix = cfgAnn.stringArg ?? cfgAnn.pairs?.prefix ?? cfgAnn.pairs?.value;
    if (!prefix) continue;

    for (const field of fields) {
      if (field.parentQualifiedName !== cls.qualifiedName) continue;
      const annotations = (field.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
      if (annotations.some((a) => a.name === "Value")) continue; // explicit @Value already bound above

      file.references.push({
        fromQualifiedName: field.qualifiedName,
        rawName: configPropertyQualifiedName(`${prefix}.${field.name}`),
        kind: "call",
        edgeType: "DEPENDS_ON",
        line: field.startLine,
        attributes: { via: "config-binding" },
      });
    }
  }
}
