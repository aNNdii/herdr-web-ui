import { describe, expect, it } from "bun:test";
import { comboboxEnter, comboboxStep, type ComboboxState } from "./combobox.ts";

const closed: ComboboxState = { open: false };
const fresh: ComboboxState = { open: true, query: null, active: null };

describe("comboboxStep", () => {
  it("opens with nothing typed and no active option, and an open list stays as it is", () => {
    expect(comboboxStep(closed, { type: "open" }, 3)).toEqual(fresh);
    const moved: ComboboxState = { open: true, query: "ma", active: 1 };
    expect(comboboxStep(moved, { type: "open" }, 3)).toBe(moved);
  });

  it("opens on typing, filters by the text and leaves no option active, so Enter takes the text", () => {
    expect(comboboxStep(closed, { type: "input", text: "m" }, 3)).toEqual({ open: true, query: "m", active: null });
    expect(comboboxStep({ open: true, query: "m", active: 2 }, { type: "input", text: "ma" }, 3)).toEqual({ open: true, query: "ma", active: null });
  });

  it("moves down from the first option and up from the last, wrapping at the ends", () => {
    expect(comboboxStep(fresh, { type: "move", by: 1 }, 3)).toEqual({ open: true, query: null, active: 0 });
    expect(comboboxStep(fresh, { type: "move", by: -1 }, 3)).toEqual({ open: true, query: null, active: 2 });
    expect(comboboxStep({ open: true, query: null, active: 2 }, { type: "move", by: 1 }, 3)).toEqual({ open: true, query: null, active: 0 });
    expect(comboboxStep({ open: true, query: null, active: 0 }, { type: "move", by: -1 }, 3)).toEqual({ open: true, query: null, active: 2 });
    expect(comboboxStep({ open: true, query: "x", active: 1 }, { type: "move", by: "first" }, 3)).toEqual({ open: true, query: "x", active: 0 });
    expect(comboboxStep({ open: true, query: "x", active: 1 }, { type: "move", by: "last" }, 3)).toEqual({ open: true, query: "x", active: 2 });
  });

  it("opens on an arrow key, onto the first or the last option", () => {
    expect(comboboxStep(closed, { type: "move", by: 1 }, 3)).toEqual({ open: true, query: null, active: 0 });
    expect(comboboxStep(closed, { type: "move", by: -1 }, 3)).toEqual({ open: true, query: null, active: 2 });
  });

  it("has no active option when nothing matches", () => {
    expect(comboboxStep({ open: true, query: "zz", active: null }, { type: "move", by: 1 }, 0)).toEqual({ open: true, query: "zz", active: null });
    expect(comboboxStep(closed, { type: "move", by: "last" }, 0)).toEqual({ open: true, query: null, active: null });
  });

  it("follows the pointer onto an option in the list only", () => {
    expect(comboboxStep(fresh, { type: "hover", index: 1 }, 3)).toEqual({ open: true, query: null, active: 1 });
    expect(comboboxStep(fresh, { type: "hover", index: 3 }, 3)).toBe(fresh);
    expect(comboboxStep(closed, { type: "hover", index: 1 }, 3)).toBe(closed);
  });

  it("closes, forgetting the typed text", () => {
    expect(comboboxStep({ open: true, query: "ma", active: 1 }, { type: "close" }, 3)).toEqual(closed);
    expect(comboboxStep(closed, { type: "close" }, 3)).toBe(closed);
  });
});

describe("comboboxEnter", () => {
  const options = ["main", "feat/x", "origin/main"];

  it("takes the active option", () => {
    expect(comboboxEnter({ open: true, query: "ma", active: 2 }, options)).toBe("origin/main");
    expect(comboboxEnter({ open: true, query: null, active: 1 }, options)).toBe("feat/x");
  });

  it("takes free text as typed when no option is active: a tag, a SHA, HEAD~3", () => {
    expect(comboboxEnter({ open: true, query: "HEAD~3", active: null }, [])).toBe("HEAD~3");
    expect(comboboxEnter({ open: true, query: "main", active: null }, options)).toBe("main");
    expect(comboboxEnter({ open: true, query: "", active: null }, options)).toBe("");
  });

  it("takes the typed text when the active index fell out of the list", () => {
    expect(comboboxEnter({ open: true, query: "v1.2", active: 5 }, options)).toBe("v1.2");
  });

  it("takes nothing when nothing was typed or chosen, or the list is closed", () => {
    expect(comboboxEnter(fresh, options)).toBeNull();
    expect(comboboxEnter(closed, options)).toBeNull();
  });
});
