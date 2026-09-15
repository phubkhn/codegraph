import { describe, it, expect } from "vitest";
import { joinPath as normalizePath, normalizePathParams } from "../../src/core/http-path.js";

describe("normalizePath / normalizePathParams", () => {
  it("joins base and sub paths without duplicate slashes", () => {
    expect(normalizePath("/api/loans", "/{id}/disburse")).toBe("/api/loans/{param}/disburse");
    expect(normalizePath("api/loans", "{id}")).toBe("/api/loans/{param}");
    expect(normalizePath("/api/loans", "")).toBe("/api/loans");
  });

  it("normalizes {id}, :id, and {id} path params to a canonical {param}", () => {
    expect(normalizePathParams("/api/loans/{id}")).toBe("/api/loans/{param}");
    expect(normalizePathParams("/api/loans/:id")).toBe("/api/loans/{param}");
    expect(normalizePathParams("/api/loans/{id}/items/:itemId")).toBe("/api/loans/{param}/items/{param}");
  });
});
