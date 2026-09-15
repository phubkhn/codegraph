import type { ParsedFile, ParsedSymbol } from "../../core/model/types.js";
import type { AnnotationInfo } from "./java-parser.js";
import { endpointQualifiedName, joinPath } from "../../core/http-path.js";

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

const TEST_CLASS_ANNOTATIONS = ["SpringBootTest", "WebMvcTest", "DataJpaTest"];
const TEST_SUFFIX_RE = /(Test|IT)$/;

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
    const annotationNames = annotations.map((a) => a.name);
    const componentType = annotations.map((a) => COMPONENT_ANNOTATIONS[a.name]).find(Boolean);
    if (componentType) {
      cls.metadata = { ...cls.metadata, framework: "spring", springComponentType: componentType };
    }

    if (annotationNames.includes("Entity")) {
      cls.type = "ENTITY";
      cls.metadata = { ...cls.metadata, framework: "spring", jpaEntity: true };
    }

    const isTestClass =
      annotationNames.some((n) => TEST_CLASS_ANNOTATIONS.includes(n)) ||
      (TEST_SUFFIX_RE.test(cls.name) && methods.some((m) => m.parentQualifiedName === cls.qualifiedName && hasAnnotation(m, "Test")));
    if (isTestClass) {
      cls.type = "TEST";
      cls.metadata = { ...cls.metadata, framework: "spring", testFramework: "junit" };
      const subjectName = cls.name.replace(TEST_SUFFIX_RE, "");
      if (subjectName && subjectName !== cls.name) {
        file.typeRelations.push({
          fromQualifiedName: cls.qualifiedName,
          targetName: subjectName,
          edgeType: "TESTED_BY",
        });
      }
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
        const path = joinPath(basePath ?? "", mappingPath(mappingAnn));

        const endpointQName = endpointQualifiedName(httpMethod, path);
        extraSymbols.push({
          type: "REST_ENDPOINT",
          name: `${httpMethod} ${path}`,
          qualifiedName: endpointQName,
          startLine: method.startLine,
          endLine: method.startLine,
          parentQualifiedName: file.path,
          metadata: { framework: "spring", httpMethod, path, handlerQualifiedName: method.qualifiedName },
        });

        file.references.push({
          fromQualifiedName: endpointQName,
          rawName: method.qualifiedName,
          kind: "call",
          edgeType: "CALLS",
          line: method.startLine,
        });
      }
    }
  }

  applyKafkaTags(file, methods, extraSymbols);

  file.symbols.push(...extraSymbols);
}

function hasAnnotation(symbol: ParsedSymbol, name: string): boolean {
  const annotations = (symbol.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
  return annotations.some((a) => a.name === name);
}

/**
 * Kafka producer/consumer detection. Producers are found by scanning already-collected
 * CALLS references for the `kafkaTemplate.send("topic", ...)` shape (java-parser captures
 * `firstStringArg` generically for any call, with no Kafka-specific knowledge); consumers are
 * found via @KafkaListener method annotations. Both sides resolve to the same synthetic
 * KAFKA_TOPIC node id (qualifiedName-only, no file/line) so producer and consumer edges in
 * different files converge on one topic node instead of creating duplicates.
 */
function applyKafkaTags(file: ParsedFile, methods: ParsedSymbol[], extraSymbols: ParsedSymbol[]): void {
  const seenTopics = new Set<string>();
  const ensureTopic = (topic: string, resolution?: "partial") => {
    const qualifiedName = `KAFKA_TOPIC:${topic}`;
    if (!seenTopics.has(topic)) {
      seenTopics.add(topic);
      extraSymbols.push({
        type: "KAFKA_TOPIC",
        name: topic,
        qualifiedName,
        startLine: 1,
        endLine: 1,
        parentQualifiedName: file.path,
        metadata: { framework: "spring", topic, ...(resolution ? { resolution } : {}) },
      });
    }
    return qualifiedName;
  };

  for (const ref of file.references) {
    if (ref.edgeType !== "CALLS" || ref.receiverType !== "KafkaTemplate" || !ref.rawName.endsWith(".send")) continue;
    if (!ref.firstStringArg) continue; // dynamic topic expression - can't resolve statically in V1
    const topicQualifiedName = ensureTopic(ref.firstStringArg);
    file.references.push({
      fromQualifiedName: ref.fromQualifiedName,
      rawName: topicQualifiedName,
      kind: "call",
      edgeType: "PRODUCES",
      line: ref.line,
    });
  }

  for (const method of methods) {
    const listenerAnn = ((method.metadata?.annotations as AnnotationInfo[] | undefined) ?? []).find(
      (a) => a.name === "KafkaListener",
    );
    if (!listenerAnn) continue;
    const topic = listenerAnn.pairs?.topics ?? listenerAnn.stringArg;
    if (!topic) continue;
    const topicQualifiedName = ensureTopic(topic);
    file.references.push({
      fromQualifiedName: method.qualifiedName,
      rawName: topicQualifiedName,
      kind: "call",
      edgeType: "CONSUMES",
      line: method.startLine,
    });
  }
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

