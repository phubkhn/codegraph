import posixPath from "node:path/posix";

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/**
 * Resolves a relative TS/JS import specifier (e.g. "./useLoan") from `fromFile`
 * to a project-relative file path, if that file exists in `knownFiles`.
 */
export function resolveRelativeImport(fromFile: string, importSource: string, knownFiles: Set<string>): string | undefined {
  if (!importSource.startsWith(".")) return undefined;
  const base = posixPath.normalize(posixPath.join(posixPath.dirname(fromFile), importSource));
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (knownFiles.has(candidate)) return candidate;
  }
  return undefined;
}
