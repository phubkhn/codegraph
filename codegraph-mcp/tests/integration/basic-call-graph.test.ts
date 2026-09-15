import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { indexFixture, type TestProject } from "../test-helpers.js";

// Matches implementation plan Step 1.11: A.foo() -> B.bar() -> C.baz()
describe("basic Java call graph (A -> B -> C)", () => {
  let project: TestProject;

  beforeAll(async () => {
    project = await indexFixture(join(import.meta.dirname, "../fixtures/basic-java"));
  });

  afterAll(() => project.cleanup());

  it("finds B.bar via search", () => {
    const results = project.queryService.searchSymbols("B.bar");
    expect(results.some((n) => n.qualifiedName === "com.example.basic.B.bar")).toBe(true);
  });

  it("resolves callers(B.bar) => A.foo", () => {
    const bBar = project.queryService.resolveSymbol("com.example.basic.B.bar")!;
    const callers = project.queryService.getCallers(bBar.id);
    expect(callers.map((n) => n.qualifiedName)).toContain("com.example.basic.A.foo");
  });

  it("resolves callees(B.bar) => C.baz", () => {
    const bBar = project.queryService.resolveSymbol("com.example.basic.B.bar")!;
    const callees = project.queryService.getCallees(bBar.id);
    expect(callees.map((n) => n.qualifiedName)).toContain("com.example.basic.C.baz");
  });

  it("finds path A.foo -> B.bar -> C.baz", () => {
    const aFoo = project.queryService.resolveSymbol("com.example.basic.A.foo")!;
    const cBaz = project.queryService.resolveSymbol("com.example.basic.C.baz")!;
    const path = project.queryService.findPath(aFoo.id, cBaz.id);
    expect(path).toBeDefined();
    expect(path!.nodes.map((n) => n.qualifiedName)).toEqual([
      "com.example.basic.A.foo",
      "com.example.basic.B.bar",
      "com.example.basic.C.baz",
    ]);
  });

  it("impact(C.baz) => B.bar, A.foo", () => {
    const cBaz = project.queryService.resolveSymbol("com.example.basic.C.baz")!;
    const impact = project.queryService.impactAnalysis(cBaz.id);
    const names = impact!.affected.map((a) => a.node.qualifiedName);
    expect(names).toContain("com.example.basic.B.bar");
    expect(names).toContain("com.example.basic.A.foo");
  });
});
