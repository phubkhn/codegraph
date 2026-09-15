import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();

function wasmDir(): string {
  const wasmsPkgJson = require.resolve("tree-sitter-wasms/package.json");
  return join(dirname(wasmsPkgJson), "out");
}

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  await initPromise;
}

export type GrammarName = "java" | "typescript" | "tsx" | "javascript";

export async function loadLanguage(grammar: GrammarName): Promise<Language> {
  await ensureInit();
  const cached = languageCache.get(grammar);
  if (cached) return cached;
  const wasmPath = join(wasmDir(), `tree-sitter-${grammar}.wasm`);
  const language = await Language.load(wasmPath);
  languageCache.set(grammar, language);
  return language;
}

export async function createParser(grammar: GrammarName): Promise<Parser> {
  const language = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
