import type { ParsedFile } from "../model/types.js";

export interface LanguageParser {
  readonly id: string;
  supports(filePath: string): boolean;
  parse(filePath: string, source: string): Promise<ParsedFile>;
}
