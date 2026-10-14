import type { MobileCommentGesture } from "./settings.ts";

/**
 * The touch gesture that opens a comment on a code line: a long press, or (Settings) a tap. A
 * state machine with no DOM and no timers; the caller feeds it the touch events and a `timer` event
 * once the press may have lasted long enough, and acts on `open` and `swallowClick`.
 *
 * A long press is armed once it has lasted `LONG_PRESS_MS` and opens on the finger's lift: inside the
 * user's own gesture, where iOS Safari raises the keyboard for the field that takes the focus. A move
 * past the slop, a scroll or a cancel disarms it before then.
 */

/** How long a finger rests on a line before it opens a comment. */
export const LONG_PRESS_MS = 300;
/** A press shows its fill only after this delay, so a scroll starting on a line never flashes it. */
export const PRESS_FILL_DELAY_MS = 80;
/** How far a finger may drift from where it went down and still be a press. */
export const PRESS_SLOP_PX = 10;

export type PressState =
  | { kind: "idle" }
  | { kind: "pressing"; line: number; x: number; y: number; since: number }
  /** the press has lasted long enough: the lift opens `line` (`x`, `y`: where it went down, for the slop) */
  | { kind: "armed"; line: number; x: number; y: number }
  /** the press opened a comment: the click the browser still sends after it is swallowed */
  | { kind: "fired" };

export type PressEvent =
  | { type: "down"; line: number; x: number; y: number; at: number }
  | { type: "move"; x: number; y: number }
  | { type: "timer"; at: number }
  | { type: "up" }
  | { type: "scroll" }
  | { type: "cancel" }
  /** `line` is the line under the click, null when it is on none */
  | { type: "click"; line: number | null };

export interface PressStep {
  state: PressState;
  /** the line to open a comment on */
  open: number | null;
  /** the click this event belongs to must not reach the code (it ended a long press) */
  swallowClick: boolean;
}

const IDLE: PressState = { kind: "idle" };

/** One touch event through the recogniser; `gesture` from Settings, `mode` the comment mode. */
export function pressStep(state: PressState, event: PressEvent, gesture: MobileCommentGesture, mode: boolean): PressStep {
  const stay = (next: PressState = state): PressStep => ({ state: next, open: null, swallowClick: false });
  if (!mode) return stay(IDLE);
  switch (event.type) {
    case "down":
      return stay(gesture === "hold" ? { kind: "pressing", line: event.line, x: event.x, y: event.y, since: event.at } : IDLE);
    case "move":
      if (state.kind !== "pressing" && state.kind !== "armed") return stay();
      return stay(Math.hypot(event.x - state.x, event.y - state.y) > PRESS_SLOP_PX ? IDLE : state);
    case "timer":
      if (state.kind !== "pressing" || event.at - state.since < LONG_PRESS_MS) return stay();
      return stay({ kind: "armed", line: state.line, x: state.x, y: state.y });
    case "up":
      // an armed press opens on its lift; a fired one keeps its state until the click it still causes has been swallowed
      if (state.kind === "armed") return { state: { kind: "fired" }, open: state.line, swallowClick: false };
      return stay(state.kind === "fired" ? state : IDLE);
    case "scroll":
    case "cancel":
      return stay(IDLE);
    case "click":
      // the click of a long press: after its lift opened it, or one whose lift never came
      if (state.kind === "fired" || state.kind === "armed") return { state: IDLE, open: null, swallowClick: true };
      return { state: IDLE, open: gesture === "tap" ? event.line : null, swallowClick: false };
  }
}
