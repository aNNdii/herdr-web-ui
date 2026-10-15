/**
 * Which click on a file line opens a comment (the code view). `isCommentClick` decides from plain facts and needs no
 * DOM; `clickFacts` reads a click's facts off its event.
 */
import { COMMENT_UI_SELECTOR, inPopover } from "./commentDom.ts";

/** What a click is made of, as far as commenting cares. */
export interface ClickFacts {
  button: number;
  detail: number;
  /** the target is inside an interactive element, a comment layer or a popover (`COMMENT_CLICK_IGNORED`) */
  interactive: boolean;
  /** the document's selection is collapsed */
  selectionCollapsed: boolean;
  /** a touch screen with a text field outside a comment popover focused: the tap puts the keyboard away */
  dismissesKeyboard: boolean;
}

/** A click inside any of these never opens a comment: it belongs to the element, or to the comment UI itself. */
export const COMMENT_CLICK_IGNORED =
  `a, button, summary, input, textarea, select, label, [role='button'], [contenteditable], .markdown-code-header, .markdown-code-more, ${COMMENT_UI_SELECTOR}`;

/**
 * The presses that dismissed an open popover (a press outside it, `markDismissingPress`, CommentPopover.tsx): such a
 * press only closes it, or gives its field the focus back: the click that follows it opens no comment
 * (`isDismissingPress`, asked with the same press event by the code view's layer). Kept by the event itself, so a mark
 * never reaches another press.
 */
const dismissingPresses = new WeakSet<Event>();

/** `press` (a `pointerdown`) dismissed an open popover: it opens nothing. */
export function markDismissingPress(press: Event): void {
  dismissingPresses.add(press);
}

/** Whether `press` (a `pointerdown`) dismissed an open popover (`markDismissingPress`); none never did. */
export function isDismissingPress(press: Event | null | undefined): boolean {
  return press != null && dismissingPresses.has(press);
}

/** A plain primary single click, on nothing interactive, that does not end a selection or put the keyboard away. */
export function isCommentClick(facts: ClickFacts): boolean {
  return facts.button === 0 && facts.detail === 1 && !facts.interactive && facts.selectionCollapsed && !facts.dismissesKeyboard;
}

/**
 * DOM: a touch screen with a text field outside a comment popover focused, whose keyboard a tap elsewhere puts away.
 * Read it as the press comes down too: a press on text that cannot take the focus takes it from the field before
 * the click (`clickFacts` alone would then miss it).
 */
export function typingOnTouch(): boolean {
  const active = document.activeElement;
  const typing = active instanceof Element && active.matches("textarea, input, [contenteditable]") && !inPopover(active);
  return typing && window.matchMedia("(pointer: coarse)").matches;
}

/** DOM: the facts of `event`. */
export function clickFacts(event: MouseEvent): ClickFacts {
  const target = event.target instanceof Element ? event.target : null;
  return {
    button: event.button,
    detail: event.detail,
    interactive: target?.closest(COMMENT_CLICK_IGNORED) != null,
    selectionCollapsed: window.getSelection()?.isCollapsed ?? true,
    dismissesKeyboard: typingOnTouch(),
  };
}
