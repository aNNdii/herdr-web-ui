import { describe, expect, it } from "bun:test";

import { BUTTON_GAP_PX, buttonPlace, FIELD_GAP_PX, fieldPlace, revealBy, walkScroll } from "./selectionField.ts";

// a body whose client area starts at (100, 50) on screen, 600 × 400, scrolled 1000 down
const view = { top: 50, left: 100, width: 600, height: 400 };
const scroll = { top: 1000, left: 0 };
const field = { width: 320, height: 52 };
const inset = 8;

describe("fieldPlace", () => {
  it("puts the field's bottom 8 px above the selection's first line, in the body's content coordinates", () => {
    const place = fieldPlace({ first: { top: 250, left: 180 }, last: { bottom: 300 }, view, scroll, field, inset });
    expect(place).toEqual({ above: true, top: 250 - 50 + 1000 - FIELD_GAP_PX, left: 80 });
  });

  it("goes below the last line without room above for the field and the gap", () => {
    const place = fieldPlace({ first: { top: 50 + 52 + 7, left: 180 }, last: { bottom: 160 }, view, scroll, field, inset });
    expect(place).toEqual({ above: false, top: 160 - 50 + 1000 + FIELD_GAP_PX, left: 80 });
  });

  it("stays above with exactly the room it needs", () => {
    expect(fieldPlace({ first: { top: 50 + 52 + 8, left: 180 }, last: { bottom: 160 }, view, scroll, field, inset }).above).toBe(true);
  });

  it("keeps the side it was given, whatever the room now (a growing field does not flip)", () => {
    expect(fieldPlace({ first: { top: 60, left: 180 }, last: { bottom: 80 }, view, scroll, field: { width: 320, height: 160 }, inset, above: true }).above).toBe(true);
    expect(fieldPlace({ first: { top: 300, left: 180 }, last: { bottom: 320 }, view, scroll, field, inset, above: false }).above).toBe(false);
  });

  it("is clamped inside the body sideways, and its scroll", () => {
    expect(fieldPlace({ first: { top: 250, left: 650 }, last: { bottom: 270 }, view, scroll, field, inset }).left).toBe(600 - 320 - 8);
    expect(fieldPlace({ first: { top: 250, left: 20 }, last: { bottom: 270 }, view, scroll, field, inset }).left).toBe(8);
    expect(fieldPlace({ first: { top: 250, left: 650 }, last: { bottom: 270 }, view, scroll: { top: 0, left: 200 }, field, inset }).left).toBe(200 + 600 - 320 - 8);
  });

  it("starts at the inset in a body narrower than the field", () => {
    expect(fieldPlace({ first: { top: 250, left: 180 }, last: { bottom: 270 }, view: { ...view, width: 300 }, scroll, field, inset }).left).toBe(8);
  });
});

describe("revealBy", () => {
  const body = { top: 50, height: 400 };
  it("scrolls nothing for a field in view", () => {
    expect(revealBy({ top: 100, bottom: 152 }, body, inset)).toBe(0);
  });
  it("scrolls up just far enough for a field above the view", () => {
    expect(revealBy({ top: 20, bottom: 72 }, body, inset)).toBe(20 - 50 - 8);
  });
  it("scrolls down just far enough for a field below the view", () => {
    expect(revealBy({ top: 420, bottom: 472 }, body, inset)).toBe(472 - 450 + 8);
  });
  it("shows the top of a field taller than the view", () => {
    expect(revealBy({ top: 500, bottom: 1000 }, body, inset)).toBe(500 - 50 - 8);
  });
});

describe("walkScroll", () => {
  // a view 100 to 500 on screen
  const view = { top: 100, height: 400 };

  it("centres the text and its card when they fit", () => {
    expect(walkScroll({ top: 600, bottom: 700 }, { top: 710, bottom: 740 }, view)).toBe(370);
    expect(walkScroll({ top: 0, bottom: 40 }, { top: 50, bottom: 80 }, view)).toBe(-260);
  });

  it("brings the card's bottom to the view's bottom when they are taller than the view", () => {
    expect(walkScroll({ top: 200, bottom: 1200 }, { top: 1210, bottom: 1240 }, view)).toBe(740);
    expect(walkScroll({ top: -900, bottom: 80 }, { top: 90, bottom: 120 }, view)).toBe(-380);
  });

  it("keeps the card on screen when the text runs on below it", () => {
    expect(walkScroll({ top: 200, bottom: 1300 }, { top: 1210, bottom: 1240 }, view)).toBe(740);
  });
});

describe("buttonPlace", () => {
  const button = { width: 110, height: 34 };

  it("puts the Comment button under the selection's last line, centred on its end, in the body's content coordinates", () => {
    const place = buttonPlace({ first: { top: 200 }, last: { bottom: 240, right: 400 }, view, scroll, button, inset });
    expect(place).toEqual({ below: true, top: 240 - 50 + 1000 + BUTTON_GAP_PX, left: 400 - 100 - 55 });
  });

  it("goes above the first line without room below it in the body's view", () => {
    const bottom = 50 + 400 - inset - 34 - BUTTON_GAP_PX + 1;
    const place = buttonPlace({ first: { top: 300 }, last: { bottom, right: 400 }, view, scroll, button, inset });
    expect(place).toEqual({ below: false, top: 300 - 50 + 1000 - BUTTON_GAP_PX - 34, left: 245 });
  });

  it("stays below where there is room on neither side", () => {
    const place = buttonPlace({ first: { top: 60 }, last: { bottom: 440, right: 400 }, view, scroll, button, inset });
    expect(place.below).toBe(true);
  });

  it("is kept inside the body's sides, scrolled sideways too", () => {
    expect(buttonPlace({ first: { top: 200 }, last: { bottom: 240, right: 110 }, view, scroll, button, inset }).left).toBe(inset);
    expect(buttonPlace({ first: { top: 200 }, last: { bottom: 240, right: 698 }, view, scroll: { top: 1000, left: 40 }, button, inset }).left).toBe(40 + 600 - 110 - inset);
  });
});
