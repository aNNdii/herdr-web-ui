import { describe, expect, it } from "bun:test";

import { workflowTitle } from "./workflow-title.ts";

describe("workflowTitle", () => {
  it("takes the call's name over its script", () => {
    expect(workflowTitle("review", "/work/flows/audit.js")).toBe("review");
  });

  it("names a call without a name by its script's file, less .js, on either separator", () => {
    expect(workflowTitle(null, "/work/flows/audit.js")).toBe("audit");
    expect(workflowTitle(null, "C:\\work\\flows\\audit.js")).toBe("audit");
    expect(workflowTitle(null, "flows/audit.mjs")).toBe("audit.mjs");
    expect(workflowTitle(null, "audit")).toBe("audit");
  });

  it("says workflow when neither gives a name", () => {
    expect(workflowTitle(null, null)).toBe("workflow");
    expect(workflowTitle(null, "/work/flows/")).toBe("workflow");
    expect(workflowTitle(null, ".js")).toBe("workflow");
  });
});
