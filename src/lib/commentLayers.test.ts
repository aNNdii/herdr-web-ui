import { describe, expect, test } from "bun:test";
import { assignLayers, LAYER_COUNT } from "./commentLayers.ts";

const byNumber = (a: number, b: number): number => a - b;
const span = (id: string, start: number, end: number) => ({ id, start, end });

describe("assignLayers", () => {
  test("pools four layers", () => {
    expect(LAYER_COUNT).toBe(4);
  });

  test("two disjoint spans share layer 0", () => {
    const layers = assignLayers([span("a", 0, 5), span("b", 10, 15)], byNumber);
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(0);
  });

  test("two overlapping spans take layers 0 and 1", () => {
    const layers = assignLayers([span("a", 0, 20), span("b", 10, 30)], byNumber);
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(1);
  });

  test("a third span overlapping both takes layer 2", () => {
    const layers = assignLayers([span("a", 0, 20), span("b", 10, 30), span("c", 15, 25)], byNumber);
    expect([layers.get("a"), layers.get("b"), layers.get("c")]).toEqual([0, 1, 2]);
  });

  test("five mutually overlapping spans: the fifth reuses the last layer", () => {
    const layers = assignLayers([0, 1, 2, 3, 4].map((n) => span(`s${n}`, n, 100)), byNumber);
    expect([0, 1, 2, 3, 4].map((n) => layers.get(`s${n}`))).toEqual([0, 1, 2, 3, 3]);
  });

  test("a span starting exactly where another ends shares its layer", () => {
    const layers = assignLayers([span("a", 0, 10), span("b", 10, 20)], byNumber);
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(0);
  });

  test("works in start order whatever order the spans come in", () => {
    const layers = assignLayers([span("late", 10, 30), span("early", 0, 20)], byNumber);
    expect(layers.get("early")).toBe(0);
    expect(layers.get("late")).toBe(1);
  });

  test("a freed lower layer is taken again", () => {
    // a [0,10) on 0, b [5,30) on 1, c [12,20) finds layer 0 free again
    const layers = assignLayers([span("a", 0, 10), span("b", 5, 30), span("c", 12, 20)], byNumber);
    expect([layers.get("a"), layers.get("b"), layers.get("c")]).toEqual([0, 1, 0]);
  });

  test("no spans, no layers", () => {
    expect(assignLayers([], byNumber).size).toBe(0);
  });
});
