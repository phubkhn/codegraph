import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { indexFixture, type TestProject } from "../test-helpers.js";

describe("Lombok synthesis and Spring config binding", () => {
  let project: TestProject;

  beforeAll(async () => {
    project = await indexFixture(join(import.meta.dirname, "../fixtures/lombok-config"));
  });

  afterAll(() => project.cleanup());

  it("@Data synthesizes getters/setters (skipping a final field's setter) plus equals/hashCode/toString", () => {
    const methodNames = project.queryService
      .searchSymbols("Employee", 50)
      .filter((n) => n.qualifiedName.startsWith("com.example.Employee."))
      .map((n) => n.name);

    expect(methodNames).toContain("getId");
    expect(methodNames).not.toContain("setId"); // id is final
    expect(methodNames).toContain("getFirstName");
    expect(methodNames).toContain("setFirstName");
    // boolean primitive getter is isX(), not getX()
    expect(methodNames).toContain("isActive");
    expect(methodNames).not.toContain("getActive");
    expect(methodNames).toContain("setActive");
    expect(methodNames).toContain("equals");
    expect(methodNames).toContain("hashCode");
    expect(methodNames).toContain("toString");
  });

  it("@Builder synthesizes a static builder() method", () => {
    const builder = project.queryService.resolveSymbol("com.example.Employee.builder");
    expect(builder?.type).toBe("METHOD");
    expect(builder?.metadata?.lombok).toBe(true);
  });

  it("a call to a Lombok-generated getter resolves as a real CALLS edge", () => {
    const describe_ = project.queryService.resolveSymbol("com.example.EmployeeService.describe")!;
    const callees = project.queryService.getCallees(describe_.id).map((n) => n.qualifiedName);
    expect(callees).toContain("com.example.Employee.getFirstName");
    expect(callees).toContain("com.example.Employee.isActive");
  });

  it("an explicitly-declared method is never overridden by Lombok synthesis", () => {
    // Widget hand-writes getName() despite @Data — exactly one node should exist for it,
    // and it must be the hand-written one (not a synthesized duplicate).
    const matches = project.queryService.searchSymbols("com.example.Widget.getName", 10);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.metadata?.lombok).not.toBe(true);
  });

  it("@Slf4j synthesizes a static `log` field", () => {
    const log = project.queryService.resolveSymbol("com.example.EmployeeService.log");
    expect(log?.type).toBe("VARIABLE");
    expect(log?.metadata?.lombok).toBe(true);
  });

  it("@Value(\"${key}\") binds to the application.yml CONFIG_PROPERTY node", () => {
    const field = project.queryService.resolveSymbol("com.example.EmployeeService.defaultDepartment")!;
    const outgoing = project.queryService.getOutgoingByType(field.id);
    const dependsOn = outgoing.find((r) => r.edgeType === "DEPENDS_ON");
    expect(dependsOn?.node.type).toBe("CONFIG_PROPERTY");
    expect(dependsOn?.node.name).toBe("employee.default-department");
  });

  it("relaxed binding: kebab-case YAML key and camelCase field name converge on one CONFIG_PROPERTY node", () => {
    const field = project.queryService.resolveSymbol("com.example.CacheSettings.poolSize")!;
    const outgoing = project.queryService.getOutgoingByType(field.id);
    const dependsOn = outgoing.find((r) => r.edgeType === "DEPENDS_ON");
    expect(dependsOn?.node.type).toBe("CONFIG_PROPERTY");
    expect(dependsOn?.node.name).toBe("app.cache.pool-size");
  });

  it("@ConfigurationProperties field binding also synthesizes @Getter/@Setter on the same class", () => {
    const names = project.queryService
      .searchSymbols("CacheSettings")
      .filter((n) => n.qualifiedName.startsWith("com.example.CacheSettings."))
      .map((n) => n.name);
    expect(names).toContain("getPoolSize");
    expect(names).toContain("setPoolSize");
  });
});
