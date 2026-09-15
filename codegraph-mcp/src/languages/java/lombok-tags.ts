import type { ParsedFile, ParsedSymbol } from "../../core/model/types.js";
import type { AnnotationInfo } from "./java-parser.js";

/** Lombok logging annotations — all generate a field named `log` by default. */
const LOMBOK_LOG_ANNOTATIONS = ["Slf4j", "Log4j", "Log4j2", "Log", "CommonsLog", "JBossLog", "Flogger", "XSlf4j", "CustomLog"];

/**
 * Synthesizes the class members Lombok generates at compile time and that
 * therefore never appear in source — without this, `bean.getX()`/`setX()`,
 * `Bean.builder()`, and `log.info(...)` all resolve to nothing and every call
 * through them breaks silently, in a huge fraction of real-world Spring code.
 * Mirrors the common, mechanical annotations only:
 *
 *   @Getter / @Setter (class- or field-level)  -> getX()/isX(), setX()
 *   @Data                                       -> getters + setters (non-final) + equals/hashCode/toString
 *   @Value                                      -> getters + equals/hashCode/toString (no setters)
 *   @Builder / @SuperBuilder                    -> static builder()
 *   @ToString / @EqualsAndHashCode              -> those methods
 *   @Slf4j and the other @Log* annotations      -> the `log` field
 *
 * Not synthesized (deliberately): constructors (`new X()` already resolves to
 * the class via the exact-qualifiedName pass; @NoArgs/@AllArgs/@RequiredArgs
 * would collide on one synthetic method name anyway), the fluent builder's own
 * setter methods, and @Accessors(fluent=true) naming. A member the source
 * already declares is never overridden.
 */
export function applyLombokTags(file: ParsedFile): void {
  const classes = file.symbols.filter((s) => s.type === "CLASS" || s.type === "ENTITY" || s.type === "ENUM" || s.type === "TEST");
  const extraSymbols: ParsedSymbol[] = [];

  for (const cls of classes) {
    const classAnns = new Set(((cls.metadata?.annotations as AnnotationInfo[] | undefined) ?? []).map((a) => a.name));
    const classGetter = classAnns.has("Getter");
    const classSetter = classAnns.has("Setter");
    const isData = classAnns.has("Data");
    const isValue = classAnns.has("Value");
    const hasBuilder = classAnns.has("Builder") || classAnns.has("SuperBuilder");
    const hasToString = isData || isValue || classAnns.has("ToString");
    const hasEquals = isData || isValue || classAnns.has("EqualsAndHashCode");
    const logAnn = [...classAnns].find((a) => LOMBOK_LOG_ANNOTATIONS.includes(a));

    const fields = file.symbols.filter(
      (s) => s.type === "VARIABLE" && s.parentQualifiedName === cls.qualifiedName && s.metadata?.kind === "field",
    );

    const classHasLombok = classGetter || classSetter || isData || isValue || hasBuilder || hasToString || hasEquals || !!logAnn;
    const anyFieldHasLombok = fields.some((f) => {
      const anns = (f.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
      return anns.some((a) => a.name === "Getter" || a.name === "Setter");
    });
    if (!classHasLombok && !anyFieldHasLombok) continue;

    // Members the source already declares — Lombok never overrides an explicit one.
    const takenMethods = new Set(
      file.symbols.filter((s) => s.type === "METHOD" && s.parentQualifiedName === cls.qualifiedName).map((s) => s.name),
    );
    const takenFields = new Set(fields.map((f) => f.name));

    const emitMethod = (name: string, line: number, signature: string, fromAnnotation: string, isStatic = false): void => {
      if (!name || takenMethods.has(name)) return;
      takenMethods.add(name);
      extraSymbols.push({
        type: "METHOD",
        name,
        qualifiedName: `${cls.qualifiedName}.${name}`,
        startLine: line,
        endLine: line,
        parentQualifiedName: cls.qualifiedName,
        metadata: { language: "java", annotations: [], modifiers: isStatic ? ["public", "static"] : ["public"], isConstructor: false, lombok: true, signature, generatedFrom: fromAnnotation },
      });
    };

    for (const field of fields) {
      const modifiers = (field.metadata?.modifiers as string[] | undefined) ?? [];
      if (modifiers.includes("static")) continue; // Lombok skips static fields.
      const isFinal = modifiers.includes("final");
      const fieldAnns = (field.metadata?.annotations as AnnotationInfo[] | undefined) ?? [];
      const fieldGetter = fieldAnns.some((a) => a.name === "Getter");
      const fieldSetter = fieldAnns.some((a) => a.name === "Setter");

      const wantGetter = classGetter || isData || isValue || fieldGetter;
      const wantSetter = (classSetter || isData || fieldSetter) && !isFinal;
      if (!wantGetter && !wantSetter) continue;

      const declaredType = (field.metadata?.declaredType as string | undefined) ?? "Object";
      const isBooleanPrimitive = declaredType === "boolean";

      if (wantGetter) {
        const g = lombokGetterName(field.name, isBooleanPrimitive);
        emitMethod(g, field.startLine, `${declaredType} ${g}()`, fieldGetter ? "@Getter" : isData ? "@Data" : isValue ? "@Value" : "@Getter");
      }
      if (wantSetter) {
        const s = lombokSetterName(field.name, isBooleanPrimitive);
        emitMethod(s, field.startLine, `void ${s}(${declaredType} ${field.name})`, fieldSetter ? "@Setter" : "@Data");
      }
    }

    if (hasBuilder) {
      emitMethod("builder", cls.startLine, `static ${cls.name}.${cls.name}Builder builder()`, classAnns.has("SuperBuilder") ? "@SuperBuilder" : "@Builder", true);
    }
    if (hasToString) {
      emitMethod("toString", cls.startLine, "String toString()", isData ? "@Data" : isValue ? "@Value" : "@ToString");
    }
    if (hasEquals) {
      const from = isData ? "@Data" : isValue ? "@Value" : "@EqualsAndHashCode";
      emitMethod("equals", cls.startLine, "boolean equals(Object o)", from);
      emitMethod("hashCode", cls.startLine, "int hashCode()", from);
    }

    if (logAnn && !takenFields.has("log")) {
      takenFields.add("log");
      extraSymbols.push({
        type: "VARIABLE",
        name: "log",
        qualifiedName: `${cls.qualifiedName}.log`,
        startLine: cls.startLine,
        endLine: cls.startLine,
        parentQualifiedName: cls.qualifiedName,
        metadata: { language: "java", declaredType: "Logger", kind: "field", annotations: [], modifiers: ["private", "static"], lombok: true, generatedFrom: `@${logAnn}` },
      });
    }
  }

  file.symbols.push(...extraSymbols);
}

/** Lombok getter name: `getX`, or `isX` for a primitive boolean (keeping an existing `isFoo` field name as-is). */
function lombokGetterName(fieldName: string, isBooleanPrimitive: boolean): string {
  if (isBooleanPrimitive) {
    return /^is[A-Z]/.test(fieldName) ? fieldName : "is" + capitalize(fieldName);
  }
  return "get" + capitalize(fieldName);
}

/** Lombok setter name: `setX` (a primitive boolean field `isFoo` sets via `setFoo`). */
function lombokSetterName(fieldName: string, isBooleanPrimitive: boolean): string {
  const base = isBooleanPrimitive && /^is[A-Z]/.test(fieldName) ? fieldName.slice(2) : fieldName;
  return "set" + capitalize(base);
}

function capitalize(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
