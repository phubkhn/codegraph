import type { LanguageParser } from "./language-parser.js";

export class ParserRegistry {
  private readonly parsers: LanguageParser[] = [];

  register(parser: LanguageParser): void {
    this.parsers.push(parser);
  }

  resolve(filePath: string): LanguageParser | undefined {
    return this.parsers.find((p) => p.supports(filePath));
  }
}
