/** Normalizes {id}, :id path params to a canonical {param} form so FE and BE routes match. */
export function normalizePathParams(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? "{param}" : seg.startsWith(":") ? "{param}" : seg))
    .join("/");
}

export function joinPath(base: string, sub: string): string {
  const combined = `/${base}/${sub}`.replace(/\/+/g, "/");
  const withoutTrailing = combined.length > 1 ? combined.replace(/\/$/, "") : combined;
  return normalizePathParams(withoutTrailing);
}

/**
 * Same node-identity scheme used by both the Java/Spring REST_ENDPOINT symbols and the React
 * API-client MAPS_TO_ENDPOINT targets, so a frontend call and its backend handler converge on
 * exactly one shared node (see graph-builder's SHARED_IDENTITY_NODE_TYPES) instead of two.
 */
export function endpointQualifiedName(httpMethod: string, path: string): string {
  return `ENDPOINT:${httpMethod} ${path}`;
}
