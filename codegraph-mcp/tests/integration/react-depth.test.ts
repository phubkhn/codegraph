import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { indexFixture, type TestProject } from "../test-helpers.js";

describe("React depth: props, API client join, router, test mapping", () => {
  let project: TestProject;

  beforeAll(async () => {
    project = await indexFixture(join(import.meta.dirname, "../fixtures/react-depth"), {
      roots: ["backend", "frontend"],
    });
  });

  afterAll(() => project.cleanup());

  it("captures JSX prop names on the RENDERS edge", () => {
    const page = project.queryService.resolveSymbol("frontend/src/pages/LoanNewPage.tsx::LoanNewPage")!;
    const outgoing = project.queryService.getOutgoingByType(page.id);
    const renders = outgoing.find((r) => r.edgeType === "RENDERS" && r.node.name === "LoanForm");
    expect(renders).toBeDefined();
  });

  it("frontend API client call maps to the same REST_ENDPOINT node as the backend handler", () => {
    const createLoan = project.queryService.resolveSymbol("frontend/src/api/loanApi.ts::createLoan")!;
    const controllerMethod = project.queryService.resolveSymbol("com.example.loan.LoanController.create")!;

    const outgoing = project.queryService.getOutgoingByType(createLoan.id);
    const mapsTo = outgoing.find((r) => r.edgeType === "MAPS_TO_ENDPOINT");
    expect(mapsTo?.node.type).toBe("REST_ENDPOINT");
    expect(mapsTo?.node.name).toBe("POST /api/loans");

    const endpointOutgoing = project.queryService.getOutgoingByType(mapsTo!.node.id);
    const handlerEdge = endpointOutgoing.find((r) => r.edgeType === "CALLS" && r.node.qualifiedName === controllerMethod.qualifiedName);
    expect(handlerEdge).toBeDefined();
  });

  it("full-stack path: route -> page -> hook -> api client -> backend endpoint -> controller method", () => {
    const route = project.queryService.resolveSymbol("ROUTE:/loans/new")!;
    const controllerMethod = project.queryService.resolveSymbol("com.example.loan.LoanController.create")!;
    // route -> page -> hook -> api client -> endpoint -> controller method is 5 hops,
    // deeper than the default maxDepth (tuned for token budget on ordinary queries).
    const path = project.queryService.findPath(route.id, controllerMethod.id, 8);
    expect(path).toBeDefined();
    const names = path!.nodes.map((n) => n.qualifiedName);
    expect(names[0]).toBe("ROUTE:/loans/new");
    expect(names).toContain("frontend/src/pages/LoanNewPage.tsx::LoanNewPage");
    expect(names).toContain("frontend/src/hooks/useCreateLoan.ts::useCreateLoan");
    expect(names).toContain("frontend/src/api/loanApi.ts::createLoan");
    expect(names[names.length - 1]).toBe("com.example.loan.LoanController.create");
  });

  it("react-router Route renders its element component", () => {
    const route = project.queryService.resolveSymbol("ROUTE:/loans/new")!;
    expect(route.type).toBe("ROUTE");
    const outgoing = project.queryService.getOutgoingByType(route.id);
    const renders = outgoing.find((r) => r.edgeType === "RENDERS");
    expect(renders?.node.qualifiedName).toBe("frontend/src/pages/LoanNewPage.tsx::LoanNewPage");
  });

  it("test file maps to its subject component by naming convention", () => {
    const form = project.queryService.resolveSymbol("frontend/src/components/LoanForm.tsx::LoanForm")!;
    const outgoing = project.queryService.getOutgoingByType(form.id);
    const testedBy = outgoing.find((r) => r.edgeType === "TESTED_BY");
    expect(testedBy?.node.type).toBe("FILE");
    expect(testedBy?.node.qualifiedName).toBe("frontend/src/components/LoanForm.test.tsx");
  });

  it("strips a leading ${BASE_URL} template prefix so the path still maps to the backend endpoint", () => {
    const deleteLoan = project.queryService.resolveSymbol("frontend/src/api/loanApi.ts::deleteLoan")!;
    const controllerMethod = project.queryService.resolveSymbol("com.example.loan.LoanController.delete")!;

    const outgoing = project.queryService.getOutgoingByType(deleteLoan.id);
    const mapsTo = outgoing.find((r) => r.edgeType === "MAPS_TO_ENDPOINT");
    expect(mapsTo?.node.type).toBe("REST_ENDPOINT");
    expect(mapsTo?.node.name).toBe("DELETE /api/loans/{param}");

    const endpointOutgoing = project.queryService.getOutgoingByType(mapsTo!.node.id);
    const handlerEdge = endpointOutgoing.find((r) => r.edgeType === "CALLS" && r.node.qualifiedName === controllerMethod.qualifiedName);
    expect(handlerEdge).toBeDefined();
  });

  it("detects react-router v6.4+ createBrowserRouter([{path, element}]) object config", () => {
    const route = project.queryService.resolveSymbol("ROUTE:/loans/create");
    expect(route?.type).toBe("ROUTE");
    const outgoing = project.queryService.getOutgoingByType(route!.id);
    const renders = outgoing.find((r) => r.edgeType === "RENDERS");
    expect(renders?.node.qualifiedName).toBe("frontend/src/pages/LoanNewPage.tsx::LoanNewPage");
  });
});
