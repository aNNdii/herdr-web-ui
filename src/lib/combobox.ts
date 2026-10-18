/**
 * An editable combobox with a filtered list (the ARIA combobox pattern, list autocomplete
 * without automatic selection), as a pure reducer so the component only wires keys to events.
 *
 * `query` is the text typed since the list opened, null while nothing was typed (the list
 * shows every option and the field its value). `active` indexes the options the list shows
 * now; typing clears it, so Enter takes the typed text unless an arrow key picked an option.
 */
export type ComboboxState = { open: false } | { open: true; query: string | null; active: number | null };

export type ComboboxEvent =
  | { type: "open" }
  | { type: "input"; text: string }
  | { type: "move"; by: 1 | -1 | "first" | "last" }
  | { type: "hover"; index: number }
  | { type: "close" };

const CLOSED: ComboboxState = { open: false };

/** The state after `event`, with `count` options in the list as it is shown now. */
export function comboboxStep(state: ComboboxState, event: ComboboxEvent, count: number): ComboboxState {
  switch (event.type) {
    case "open":
      return state.open ? state : { open: true, query: null, active: null };
    case "input":
      return { open: true, query: event.text, active: null };
    case "move": {
      const query = state.open ? state.query : null;
      if (count === 0) return { open: true, query, active: null };
      const current = state.open ? state.active : null;
      return { open: true, query, active: moved(current, event.by, count) };
    }
    case "hover":
      return state.open && event.index >= 0 && event.index < count ? { ...state, active: event.index } : state;
    case "close":
      return state.open ? CLOSED : state;
  }
}

function moved(current: number | null, by: 1 | -1 | "first" | "last", count: number): number {
  if (by === "first") return 0;
  if (by === "last") return count - 1;
  if (current === null || current >= count) return by === 1 ? 0 : count - 1;
  return (current + by + count) % count;
}

/** What Enter takes: the active option, otherwise the text as typed, otherwise nothing. */
export function comboboxEnter(state: ComboboxState, options: readonly string[]): string | null {
  if (!state.open) return null;
  const option = state.active === null ? undefined : options[state.active];
  return option ?? state.query;
}
