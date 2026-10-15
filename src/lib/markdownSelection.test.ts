import { describe, expect, it } from "bun:test";
import { releaseBlock } from "./markdownSelection.ts";

const BLOCKS = [{ top: 0, bottom: 40 }, { top: 56, bottom: 96 }, { top: 112, bottom: 150 }];

describe("releaseBlock", () => {
  it("names the last unit whose top is at or above the release height", () => {
    expect(releaseBlock(BLOCKS, 70)).toBe(1);
    expect(releaseBlock(BLOCKS, 120)).toBe(2);
    expect(releaseBlock(BLOCKS, 56)).toBe(1);
  });
  it("names the unit above when the release is in the gap between two units (bottom is not read)", () => {
    expect(releaseBlock(BLOCKS, 48)).toBe(0);
    expect(releaseBlock(BLOCKS, 100)).toBe(1);
    expect(releaseBlock([{ top: 0, bottom: 0 }, { top: 56, bottom: 0 }], 30)).toBe(0);
  });
  it("names the last unit when the release is below all of them", () => {
    expect(releaseBlock(BLOCKS, 400)).toBe(2);
  });
  it("names the first unit when the release is above all of them", () => {
    expect(releaseBlock(BLOCKS, -20)).toBe(0);
  });
  it("names 0 when there are no units", () => {
    expect(releaseBlock([], 10)).toBe(0);
  });
});
