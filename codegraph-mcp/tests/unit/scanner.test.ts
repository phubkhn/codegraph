import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/core/config/config.js";
import { scanProject } from "../../src/core/scanner/file-scanner.js";

describe("scanProject", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function makeProject(): string {
    const root = mkdtempSync(join(tmpdir(), "codegraph-scan-test-"));
    dirs.push(root);
    return root;
  }

  it("ignores node_modules/target/build by default and respects .gitignore", async () => {
    const root = makeProject();
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules", "Ignored.java"), "class Ignored {}");
    mkdirSync(join(root, "target"), { recursive: true });
    writeFileSync(join(root, "target", "Built.java"), "class Built {}");
    writeFileSync(join(root, "Main.java"), "class Main {}");
    writeFileSync(join(root, "Skip.java"), "class Skip {}");
    writeFileSync(join(root, ".gitignore"), "Skip.java\n");

    const config = defaultConfig("test");
    const result = await scanProject(root, config);

    const relPaths = result.files.map((f) => f.relPath);
    expect(relPaths).toContain("Main.java");
    expect(relPaths).not.toContain("Skip.java");
    expect(relPaths).not.toContain("node_modules/Ignored.java");
    expect(relPaths).not.toContain("target/Built.java");
  });

  it("denies secret-looking files via the security deny list", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".env"), "SECRET=1");
    writeFileSync(join(root, "App.java"), "class App {}");

    const config = defaultConfig("test");
    const result = await scanProject(root, config);
    const relPaths = result.files.map((f) => f.relPath);
    expect(relPaths).toContain("App.java");
    expect(relPaths).not.toContain(".env");
  });
});
