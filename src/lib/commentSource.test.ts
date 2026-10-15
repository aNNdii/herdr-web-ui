import { describe, expect, it } from "bun:test";
import { commentAt, commentsByText } from "./commentSource.ts";

const shown = [
  { id: "c1", quote: "first words", target: { at: "c1-place" }, textKey: "turn-a" },
  { id: "c2", quote: "second words", target: { at: "c2-place" }, textKey: "turn-b" },
  { id: "c3", quote: "third words", target: { at: "c3-place" }, textKey: "turn-a" },
];

describe("commentAt", () => {
  it("opens a new comment on the selection's target where none is stored", () => {
    expect(commentAt(shown, undefined, { at: "selected" }, "selected words")).toEqual({ target: { at: "selected" }, quote: "selected words", existing: null });
  });
  it("opens the shown comment stored there, on its own target and quote", () => {
    const at = commentAt(shown, "c2", { at: "selected" }, "selected words");
    expect(at.existing).toBe(shown[1]!);
    expect(at.target).toBe(shown[1]!.target);
    expect(at.quote).toBe("second words");
  });
  it("opens a new comment where the one stored there is not shown", () => {
    expect(commentAt(shown, "elsewhere", { at: "selected" }, "selected words")).toEqual({ target: { at: "selected" }, quote: "selected words", existing: null });
  });
});

describe("commentsByText", () => {
  it("groups the comments by the text each is on, in their order", () => {
    const byText = commentsByText(shown);
    expect([...byText.keys()]).toEqual(["turn-a", "turn-b"]);
    expect(byText.get("turn-a")!.map((comment) => comment.id)).toEqual(["c1", "c3"]);
    expect(byText.get("turn-b")!.map((comment) => comment.id)).toEqual(["c2"]);
  });
  it("leaves out a comment on no text, and has none for a text without comments", () => {
    const byText = commentsByText([{ id: "x" }, { id: "y", textKey: "turn-a" }]);
    expect(byText.size).toBe(1);
    expect(byText.get("turn-c")).toBeUndefined();
  });
});
