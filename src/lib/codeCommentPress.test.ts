import { describe, expect, it } from "bun:test";
import { LONG_PRESS_MS, PRESS_FILL_DELAY_MS, PRESS_SLOP_PX, pressStep, type PressEvent, type PressState } from "./codeCommentPress.ts";
import type { MobileCommentGesture } from "./settings.ts";

const idle: PressState = { kind: "idle" };
const down: PressEvent = { type: "down", line: 7, x: 100, y: 200, at: 0 };

/** Runs `events` from idle and returns the last step plus every opened line. */
function run(events: PressEvent[], gesture: MobileCommentGesture = "hold", mode = true, from: PressState = idle) {
  let state = from;
  let last = { state, open: null as number | null, swallowClick: false };
  const opened: number[] = [];
  for (const event of events) {
    last = pressStep(state, event, gesture, mode);
    state = last.state;
    if (last.open !== null) opened.push(last.open);
  }
  return { ...last, opened };
}

describe("constants", () => {
  it("are the spec's values", () => {
    expect(LONG_PRESS_MS).toBe(300);
    expect(PRESS_FILL_DELAY_MS).toBe(80);
    expect(PRESS_SLOP_PX).toBe(10);
  });
});

describe("pressStep: hold", () => {
  it("a down starts pressing at the line", () => {
    expect(pressStep(idle, down, "hold", true)).toEqual({ state: { kind: "pressing", line: 7, x: 100, y: 200, since: 0 }, open: null, swallowClick: false });
  });

  it("arms the press once it has lasted 300 ms, not before, and opens nothing yet", () => {
    expect(run([down, { type: "timer", at: 299 }]).state.kind).toBe("pressing");
    const armed = run([down, { type: "timer", at: 300 }]);
    expect(armed.state).toEqual({ kind: "armed", line: 7, x: 100, y: 200 });
    expect(armed.open).toBeNull();
    expect(armed.swallowClick).toBe(false);
  });

  it("opens the armed line on the lift, inside the finger's own gesture", () => {
    const lifted = run([down, { type: "timer", at: 300 }, { type: "up" }]);
    expect(lifted.open).toBe(7);
    expect(lifted.state).toEqual({ kind: "fired" });
    expect(lifted.opened).toEqual([7]);
  });

  it("a lift before 300 ms opens nothing", () => {
    expect(run([down, { type: "timer", at: 299 }, { type: "up" }]).opened).toEqual([]);
  });

  it("measures the press from its own down, not from zero", () => {
    const late: PressEvent = { type: "down", line: 4, x: 0, y: 0, at: 1000 };
    expect(run([late, { type: "timer", at: 1299 }, { type: "up" }]).opened).toEqual([]);
    expect(run([late, { type: "timer", at: 1300 }, { type: "up" }]).opened).toEqual([4]);
  });

  it("swallows the click that follows the lift of a long press, once", () => {
    const click = run([down, { type: "timer", at: 300 }, { type: "up" }, { type: "click", line: 7 }]);
    expect(click.swallowClick).toBe(true);
    expect(click.open).toBeNull();
    expect(click.state).toEqual(idle);
    expect(pressStep(click.state, { type: "click", line: 7 }, "hold", true)).toEqual({ state: idle, open: null, swallowClick: false });
  });

  it("arms and opens only once per press", () => {
    expect(run([down, { type: "timer", at: 300 }, { type: "timer", at: 400 }, { type: "up" }, { type: "up" }]).opened).toEqual([7]);
  });

  it("a move of more than 10 px, a scroll or a cancel after arming disarms it: the lift opens nothing", () => {
    for (const event of [{ type: "move", x: 100, y: 211 }, { type: "scroll" }, { type: "cancel" }] as PressEvent[]) {
      expect(run([down, { type: "timer", at: 300 }, event]).state).toEqual(idle);
      expect(run([down, { type: "timer", at: 300 }, event, { type: "up" }, { type: "click", line: 7 }]).opened).toEqual([]);
      expect(run([down, { type: "timer", at: 300 }, event, { type: "up" }, { type: "click", line: 7 }]).swallowClick).toBe(false);
    }
  });

  it("an armed press keeps a move within 10 px of its down point", () => {
    expect(run([down, { type: "timer", at: 300 }, { type: "move", x: 106, y: 208 }]).state.kind).toBe("armed");
    expect(run([down, { type: "timer", at: 300 }, { type: "move", x: 106, y: 208 }, { type: "up" }]).opened).toEqual([7]);
  });

  it("a click while armed (its lift was lost) belongs to the press: swallowed, opening nothing", () => {
    expect(run([down, { type: "timer", at: 300 }, { type: "click", line: 7 }])).toMatchObject({ state: idle, open: null, swallowClick: true, opened: [] });
  });

  it("is cancelled by a move of more than 10 px, in any direction", () => {
    for (const { x, y } of [{ x: 111, y: 200 }, { x: 89, y: 200 }, { x: 100, y: 211 }, { x: 100, y: 189 }]) {
      const moved = run([down, { type: "move", x, y }]);
      expect(moved.state).toEqual(idle);
      expect(moved.open).toBeNull();
      expect(run([down, { type: "move", x, y }, { type: "timer", at: 300 }]).open).toBeNull();
    }
  });

  it("measures the slop as a distance from the down point", () => {
    // 8 px on each axis is 11.3 px away
    expect(run([down, { type: "move", x: 108, y: 208 }]).state).toEqual(idle);
    // 6 px and 8 px is exactly 10 px
    expect(run([down, { type: "move", x: 106, y: 208 }]).state.kind).toBe("pressing");
  });

  it("keeps pressing at a move of exactly 10 px and still opens", () => {
    const moved = run([down, { type: "move", x: 110, y: 200 }]);
    expect(moved.state.kind).toBe("pressing");
    expect(run([down, { type: "move", x: 110, y: 200 }, { type: "timer", at: 300 }, { type: "up" }]).open).toBe(7);
  });

  it("measures every move from the down point, not from the last move", () => {
    expect(run([down, { type: "move", x: 106, y: 200 }, { type: "move", x: 112, y: 200 }]).state).toEqual(idle);
  });

  for (const type of ["scroll", "up", "cancel"] as const) {
    it(`a ${type} ends the press without opening, and the click after it is not swallowed`, () => {
      const ended = run([down, { type }]);
      expect(ended.state).toEqual(idle);
      expect(ended.open).toBeNull();
      expect(run([down, { type }, { type: "timer", at: 300 }, { type: "up" }]).opened).toEqual([]);
      const click = pressStep(ended.state, { type: "click", line: 7 }, "hold", true);
      expect(click).toEqual({ state: idle, open: null, swallowClick: false });
    });
  }

  it("a scroll or cancel after the press opened forgets it, so no later click is swallowed", () => {
    for (const type of ["scroll", "cancel"] as const) {
      expect(run([down, { type: "timer", at: 300 }, { type: "up" }, { type }]).state).toEqual(idle);
    }
  });

  it("a click on a plain press opens nothing", () => {
    expect(run([down, { type: "up" }, { type: "click", line: 7 }]).opened).toEqual([]);
  });

  it("a timer or a move with no press does nothing", () => {
    expect(pressStep(idle, { type: "timer", at: 500 }, "hold", true)).toEqual({ state: idle, open: null, swallowClick: false });
    expect(pressStep(idle, { type: "move", x: 500, y: 500 }, "hold", true)).toEqual({ state: idle, open: null, swallowClick: false });
  });

  it("a second down replaces the press", () => {
    const next: PressEvent = { type: "down", line: 9, x: 5, y: 5, at: 200 };
    expect(run([down, next, { type: "timer", at: 500 }, { type: "up" }]).opened).toEqual([9]);
  });
});

describe("pressStep: tap", () => {
  it("a down starts no press, so a timer never opens", () => {
    expect(run([down, { type: "timer", at: 300 }], "tap").opened).toEqual([]);
    expect(run([down, { type: "timer", at: 5000 }], "tap").state).toEqual(idle);
    expect(run([down, { type: "timer", at: 5000 }, { type: "up" }], "tap").opened).toEqual([]);
  });

  it("a click on a line opens it, one on nothing does not", () => {
    expect(pressStep(idle, { type: "click", line: 7 }, "tap", true)).toEqual({ state: idle, open: 7, swallowClick: false });
    expect(pressStep(idle, { type: "click", line: null }, "tap", true)).toEqual({ state: idle, open: null, swallowClick: false });
  });

  it("opens by click after a down and an up", () => {
    expect(run([down, { type: "up" }, { type: "click", line: 7 }], "tap").opened).toEqual([7]);
  });

  it("swallows nothing", () => {
    expect(run([down, { type: "timer", at: 300 }, { type: "up" }, { type: "click", line: 7 }], "tap").swallowClick).toBe(false);
  });
});

describe("pressStep: comment mode off", () => {
  const events: PressEvent[] = [down, { type: "move", x: 101, y: 200 }, { type: "timer", at: 300 }, { type: "timer", at: 900 }, { type: "up" }, { type: "scroll" }, { type: "cancel" }, { type: "click", line: 7 }, { type: "click", line: null }];
  for (const gesture of ["hold", "tap"] as const) {
    it(`opens and swallows nothing in ${gesture}`, () => {
      let state: PressState = idle;
      for (const event of events) {
        const step = pressStep(state, event, gesture, false);
        expect(step.open).toBeNull();
        expect(step.swallowClick).toBe(false);
        state = step.state;
      }
    });
  }

  it("an armed press opens nothing on the lift once the mode is off", () => {
    expect(pressStep({ kind: "armed", line: 7, x: 0, y: 0 }, { type: "up" }, "hold", false)).toEqual({ state: idle, open: null, swallowClick: false });
  });

  it("does not swallow the click of a press that fired just before the mode went off", () => {
    expect(pressStep({ kind: "fired" }, { type: "click", line: 7 }, "hold", false)).toEqual({ state: idle, open: null, swallowClick: false });
  });
});
