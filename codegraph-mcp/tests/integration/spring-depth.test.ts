import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { indexFixture, type TestProject } from "../test-helpers.js";

describe("Spring depth: DI, JPA entities, Kafka, test mapping", () => {
  let project: TestProject;

  beforeAll(async () => {
    project = await indexFixture(join(import.meta.dirname, "../fixtures/spring-depth"));
  });

  afterAll(() => project.cleanup());

  it("constructor injection creates a DEPENDS_ON edge (LoanService -> LoanRepository)", () => {
    const service = project.queryService.resolveSymbol("com.example.loan.LoanService")!;
    const outgoing = project.queryService.getOutgoingByType(service.id);
    const dependsOn = outgoing.filter((r) => r.edgeType === "DEPENDS_ON").map((r) => r.node.qualifiedName);
    expect(dependsOn).toContain("com.example.loan.LoanRepository");
  });

  it("@Autowired field injection creates a DEPENDS_ON edge (LoanService -> NotificationService)", () => {
    const service = project.queryService.resolveSymbol("com.example.loan.LoanService")!;
    const outgoing = project.queryService.getOutgoingByType(service.id);
    const dependsOn = outgoing.filter((r) => r.edgeType === "DEPENDS_ON").map((r) => r.node.qualifiedName);
    expect(dependsOn).toContain("com.example.loan.NotificationService");
  });

  it("repository generic entity argument creates a DEPENDS_ON edge (LoanRepository -> Loan) and tags the entity", () => {
    const repo = project.queryService.resolveSymbol("com.example.loan.LoanRepository")!;
    expect(repo.metadata?.repositoryEntity).toBe("Loan");
    const outgoing = project.queryService.getOutgoingByType(repo.id);
    const dependsOn = outgoing.filter((r) => r.edgeType === "DEPENDS_ON").map((r) => r.node.qualifiedName);
    expect(dependsOn).toContain("com.example.loan.Loan");
  });

  it("tags @Entity classes as ENTITY and models JPA relationship fields as DEPENDS_ON", () => {
    const loan = project.queryService.resolveSymbol("com.example.loan.Loan")!;
    expect(loan.type).toBe("ENTITY");

    const outgoing = project.queryService.getOutgoingByType(loan.id);
    const dependsOn = outgoing.filter((r) => r.edgeType === "DEPENDS_ON");
    const targets = dependsOn.map((r) => r.node.qualifiedName);
    expect(targets).toContain("com.example.loan.Customer");
    expect(targets).toContain("com.example.loan.Payment");

    const customerRel = dependsOn.find((r) => r.node.qualifiedName === "com.example.loan.Customer");
    expect(customerRel).toBeDefined();
  });

  it("Kafka producer and consumer converge on the same KAFKA_TOPIC node", () => {
    const disburse = project.queryService.resolveSymbol("com.example.loan.DisbursementService.execute")!;
    const listener = project.queryService.resolveSymbol("com.example.loan.AccountingListener.onLoanDisbursed")!;

    const producerOutgoing = project.queryService.getOutgoingByType(disburse.id);
    const produces = producerOutgoing.find((r) => r.edgeType === "PRODUCES");
    expect(produces?.node.type).toBe("KAFKA_TOPIC");
    expect(produces?.node.name).toBe("loan.disbursed");

    const consumerOutgoing = project.queryService.getOutgoingByType(listener.id);
    const consumes = consumerOutgoing.find((r) => r.edgeType === "CONSUMES");
    expect(consumes?.node.type).toBe("KAFKA_TOPIC");

    // both producer and consumer must resolve to the exact same topic node (shared identity id)
    expect(consumes?.node.id).toBe(produces?.node.id);
  });

  it("impact analysis on the Kafka topic shows both the producer and the consumer", () => {
    const disburse = project.queryService.resolveSymbol("com.example.loan.DisbursementService.execute")!;
    const producerOutgoing = project.queryService.getOutgoingByType(disburse.id);
    const topic = producerOutgoing.find((r) => r.edgeType === "PRODUCES")!.node;

    const impact = project.queryService.impactAnalysis(topic.id)!;
    const names = impact.affected.map((a) => a.node.qualifiedName);
    expect(names).toContain("com.example.loan.DisbursementService.execute");
    expect(names).toContain("com.example.loan.AccountingListener.onLoanDisbursed");
  });

  it("best-effort test mapping: LoanService -[TESTED_BY]-> LoanServiceTest", () => {
    const service = project.queryService.resolveSymbol("com.example.loan.LoanService")!;
    const outgoing = project.queryService.getOutgoingByType(service.id);
    const testedBy = outgoing.find((r) => r.edgeType === "TESTED_BY");
    expect(testedBy?.node.qualifiedName).toBe("com.example.loan.LoanServiceTest");
    expect(testedBy?.node.type).toBe("TEST");
  });
});
