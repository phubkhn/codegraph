import type { ParsedFile, ParsedSymbol } from "../../core/model/types.js";
import type { AnnotationInfo } from "./java-parser.js";

const COMPONENT_ANNOTATIONS: Record<string, string> = {
  RestController: "controller",
  Controller: "controller",
  Service: "service",
  Repository: "repository",
  Component: "component",
  Configuration: "configuration",
};

const MAPPING_ANNOTATIONS: Record<string, string | undefined> = {
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  PatchMapping: "PATCH",
  DeleteMapping: "DELETE",
  RequestMapping: undefined,
};

/**
 * Enriches a parsed Java file in place with Spring semantics: component type
 * tags on classes, and synthetic REST_ENDPOINT symbols + resolved references
 * to their handler methods. Core parsing stays framework-agnostic; this is
 * the semantic layer described in the implementation plan.
 */
export function applySpringTags(file: ParsedFile): void {
  const classes = file.symbols.filter((s) => s.type === "CLASS" || s.type === "INTERFACE");
  const methods = file.symbols.filter((s) => s.type === "METHOD");
  const extraSymbols: ParsedSymbol[] = [];

  for (const cls of classes) {
    const annotations = (cls.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
    const componentType = annotations.map((a) => COMPONENT_ANNOTATIONS[a.name]).find(Boolean);
    if (componentType) {
      cls.metadata = { ...cls.metadata, framework: "spring", springComponentType: componentType };
    }

    const isRepository =
      componentType === "repository" ||
      file.typeRelations.some(
        (r) => r.fromQualifiedName === cls.qualifiedName && /Repository$/.test(r.targetName),
      );
    if (isRepository) {
      cls.metadata = { ...cls.metadata, framework: "spring", springComponentType: cls.metadata?.springComponentType ?? "repository" };
    }

    const isController = componentType === "controller";
    const classMapping = annotations.find((a) => a.name === "RequestMapping");
    const basePath = isController ? (classMapping ? mappingPath(classMapping) : "") : undefined;

    if (isController) {
      for (const method of methods.filter((m) => m.parentQualifiedName === cls.qualifiedName)) {
        const methodAnnotations = (method.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
        const mappingAnn = methodAnnotations.find((a) => a.name in MAPPING_ANNOTATIONS);
        if (!mappingAnn) continue;

        const httpMethod = MAPPING_ANNOTATIONS[mappingAnn.name] ?? extractRequestMethod(mappingAnn) ?? "ANY";
        const path = normalizePath(basePath ?? "", mappingPath(mappingAnn));

        const endpointQualifiedName = `ENDPOINT:${httpMethod} ${path}`;
        extraSymbols.push({
          type: "REST_ENDPOINT",
          name: `${httpMethod} ${path}`,
          qualifiedName: endpointQualifiedName,
          startLine: method.startLine,
          endLine: method.startLine,
          parentQualifiedName: file.path,
          metadata: { framework: "spring", httpMethod, path, handlerQualifiedName: method.qualifiedName },
        });

        file.references.push({
          fromQualifiedName: endpointQualifiedName,
          rawName: method.qualifiedName,
          kind: "call",
          edgeType: "CALLS",
          line: method.startLine,
        });
      }
    }
  }

  file.symbols.push(...extraSymbols);
}

function mappingPath(ann: AnnotationInfo): string {
  return ann.stringArg ?? ann.pairs?.value ?? ann.pairs?.path ?? "";
}

function extractRequestMethod(ann: AnnotationInfo): string | undefined {
  const raw = ann.pairs?.method;
  if (!raw) return undefined;
  const parts = raw.split(".");
  return parts[parts.length - 1];
}

export function normalizePath(base: string, sub: string): string {
  const combined = `/${base}/${sub}`.replace(/\/+/g, "/");
  const withoutTrailing = combined.length > 1 ? combined.replace(/\/$/, "") : combined;
  return normalizePathParams(withoutTrailing);
}

/** Normalizes {id}, :id path params to a canonical {param} form for FE/BE matching. */
export function normalizePathParams(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? "{param}" : seg.startsWith(":") ? "{param}" : seg))
    .join("/");
}
