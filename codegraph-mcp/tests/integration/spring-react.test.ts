import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { indexFixture, type TestProject } from "../test-helpers.js";

describe("Spring backend + React frontend intelligence", () => {
  let project: TestProject;

  beforeAll(async () => {
    project = await indexFixture(join(import.meta.dirname, "../fixtures/spring-react"), {
      roots: ["backend", "frontend"],
    });
  });

  afterAll(() => project.cleanup());

  it("tags the controller/service/repository with spring component types", () => {
    const controller = project.queryService.resolveSymbol("com.example.loan.LoanController")!;
    const service = project.queryService.resolveSymbol("com.example.loan.LoanService")!;
    expect(controller.metadata?.springComponentType).toBe("controller");
    expect(service.metadata?.springComponentType).toBe("service");
  });

  it("extracts REST endpoints with normalized {param} paths", () => {
    const endpoint = project.queryService.resolveSymbol("ENDPOINT:POST /api/loans/{param}/disburse");
    expect(endpoint).toBeDefined();
    expect(endpoint!.type).toBe("REST_ENDPOINT");
    expect(endpoint!.metadata?.httpMethod).toBe("POST");
  });

  it("traces endpoint -> controller -> service -> repository", () => {
    const endpoint = project.queryService.resolveSymbol("ENDPOINT:POST /api/loans/{param}/disburse")!;
    const repoSave = project.queryService.resolveSymbol("com.example.loan.LoanRepository.save")!;
    const path = project.queryService.findPath(endpoint.id, repoSave.id);
    expect(path).toBeDefined();
    expect(path!.nodes.map((n) => n.qualifiedName)).toEqual([
      "ENDPOINT:POST /api/loans/{param}/disburse",
      "com.example.loan.LoanController.disburse",
      "com.example.loan.LoanService.disburse",
      "com.example.loan.LoanRepository.save",
    ]);
  });

  it("tags React components and hooks", () => {
    const page = project.queryService.resolveSymbol("frontend/src/pages/LoanPage.tsx::LoanPage")!;
    const hook = project.queryService.resolveSymbol("frontend/src/hooks/useLoan.ts::useLoan")!;
    expect(page.type).toBe("REACT_COMPONENT");
    expect(hook.type).toBe("REACT_HOOK");
  });

  it("traces LoanPage -> useLoan (USES_HOOK) -> getLoan (CALLS) and LoanPage -> LoanForm (RENDERS)", () => {
    const page = project.queryService.resolveSymbol("frontend/src/pages/LoanPage.tsx::LoanPage")!;
    const getLoanFn = project.queryService.resolveSymbol("frontend/src/api/loanApi.ts::getLoan")!;
    const form = project.queryService.resolveSymbol("frontend/src/components/LoanForm.tsx::LoanForm")!;

    const hookPath = project.queryService.findPath(page.id, getLoanFn.id);
    expect(hookPath!.nodes.map((n) => n.qualifiedName)).toEqual([
      "frontend/src/pages/LoanPage.tsx::LoanPage",
      "frontend/src/hooks/useLoan.ts::useLoan",
      "frontend/src/api/loanApi.ts::getLoan",
    ]);
    expect(hookPath!.edges.map((e) => e.type)).toEqual(["USES_HOOK", "CALLS"]);

    const renderPath = project.queryService.findPath(page.id, form.id);
    expect(renderPath!.edges.map((e) => e.type)).toEqual(["RENDERS"]);
  });

  it("impact analysis on LoanRepository.save groups affected endpoints", () => {
    const repoSave = project.queryService.resolveSymbol("com.example.loan.LoanRepository.save")!;
    const impact = project.queryService.impactAnalysis(repoSave.id)!;
    const endpointNode = impact.affected.find((a) => a.node.type === "REST_ENDPOINT");
    expect(endpointNode?.node.qualifiedName).toBe("ENDPOINT:POST /api/loans/{param}/disburse");
  });
});
