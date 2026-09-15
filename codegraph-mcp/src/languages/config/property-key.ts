/**
 * Canonicalizes a dotted Spring config key so the same logical property
 * converges to one node id no matter which "relaxed binding" spelling was
 * used to write it — YAML/properties files conventionally use kebab-case
 * (`pool-size`), Java identifiers are camelCase (`poolSize`), and some
 * `.properties` files use snake_case. Per-segment: lowercase, strip `-`/`_`.
 * Both the property-file parser and the `@Value`/`@ConfigurationProperties`
 * reference emitter must call this on their respective key before comparing,
 * so `pool-size`, `poolSize`, and `pool_size` all land on `CONFIG_PROPERTY:...poolsize`.
 */
export function canonicalizePropertyKey(key: string): string {
  return key
    .split(".")
    .map((segment) => segment.toLowerCase().replace(/[-_]/g, ""))
    .join(".");
}

export function configPropertyQualifiedName(key: string): string {
  return `CONFIG_PROPERTY:${canonicalizePropertyKey(key)}`;
}
