import { parseAllDocuments, visit, LineCounter, isScalar, isPair } from "yaml";
import type { LanguageParser } from "../../core/parser/language-parser.js";
import type { ParsedFile, ParsedSymbol } from "../../core/model/types.js";
import { configPropertyQualifiedName } from "./property-key.js";

/** `application.yml`, `application-prod.properties`, `bootstrap-dev.yaml`, ... (basename only). */
const SPRING_CONFIG_FILE_RE = /^(application|bootstrap)(-[\w.]+)?\.(properties|ya?ml)$/i;

/**
 * Extracts Spring config-file keys (`application*.properties`/`.yml`,
 * `bootstrap*.properties`/`.yml`) as CONFIG_PROPERTY nodes so a
 * `@Value("${key}")` / `@ConfigurationProperties` binding in Java resolves to
 * a real node instead of a dead end. Any other `.properties`/`.yml`/`.yaml`
 * file (docker-compose.yml, CI workflow files, ...) is scanned but yields no
 * symbols — this parser only knows Spring's own config-file convention.
 */
export class PropertiesParser implements LanguageParser {
  readonly id = "properties";

  supports(filePath: string): boolean {
    const base = filePath.split("/").pop() ?? filePath;
    return SPRING_CONFIG_FILE_RE.test(base);
  }

  async parse(filePath: string, source: string): Promise<ParsedFile> {
    const isYaml = /\.ya?ml$/i.test(filePath);
    const keys = isYaml ? extractYamlKeys(source) : extractPropertiesKeys(source);

    const seen = new Set<string>();
    const symbols: ParsedSymbol[] = [];
    for (const { key, line } of keys) {
      const qualifiedName = configPropertyQualifiedName(key);
      if (seen.has(qualifiedName)) continue; // same key repeated (e.g. across YAML documents)
      seen.add(qualifiedName);
      symbols.push({
        type: "CONFIG_PROPERTY",
        name: key,
        qualifiedName,
        startLine: line,
        endLine: line,
        parentQualifiedName: filePath,
        metadata: { language: "properties", framework: "spring", configKey: key },
      });
    }

    return { path: filePath, language: "properties", symbols, imports: [], references: [], typeRelations: [] };
  }
}

interface FoundKey {
  key: string;
  line: number;
}

function extractPropertiesKeys(source: string): FoundKey[] {
  const out: FoundKey[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const match = trimmed.match(/^([^=:\s][^=:]*?)\s*[=:]/);
    if (!match) continue;
    const key = match[1]!.trim();
    if (key) out.push({ key, line: i + 1 });
  }
  return out;
}

/**
 * Flattens each YAML document into dotted leaf keys (`server.port`), using
 * the CST (not `.toJS()`) so each key keeps its real source line. Multi-document
 * files (`---`-separated per-profile sections) are all visited. List items are
 * skipped — Spring's index-based list binding (`list[0]`) is a rarer shape than
 * plain scalar properties and not worth the extra complexity here.
 */
function extractYamlKeys(source: string): FoundKey[] {
  const out: FoundKey[] = [];
  const lineCounter = new LineCounter();
  let docs;
  try {
    docs = parseAllDocuments(source, { lineCounter });
  } catch {
    return out;
  }
  for (const doc of docs) {
    visit(doc, {
      Pair(_key, pair, path) {
        if (!isScalar(pair.value) || pair.value.value === null || pair.value.value === undefined) return;
        const keyNode = pair.key as { value?: unknown; range?: [number, number, number] } | null;
        const segments = path
          .filter(isPair)
          .map((p) => String((p.key as { value?: unknown } | null)?.value ?? p.key));
        segments.push(String(keyNode?.value ?? keyNode));
        const key = segments.join(".");
        const line = keyNode?.range ? lineCounter.linePos(keyNode.range[0]).line : 1;
        out.push({ key, line });
      },
    });
  }
  return out;
}
