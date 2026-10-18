import { describe, expect, it } from "bun:test";

import { countsOnlyWakingWork } from "./background-work.ts";

describe("countsOnlyWakingWork", () => {
  it("holds for the agents whose count is only work that wakes the session", () => {
    expect(countsOnlyWakingWork("pi")).toBe(true);
    expect(countsOnlyWakingWork("omo")).toBe(true);
  });

  it("does not hold for Claude, whose count also holds background shell commands, or for no agent", () => {
    expect(countsOnlyWakingWork("claude")).toBe(false);
    expect(countsOnlyWakingWork("codex")).toBe(false);
    expect(countsOnlyWakingWork(null)).toBe(false);
    expect(countsOnlyWakingWork(undefined)).toBe(false);
  });
});
