import { describe, expect, it } from "bun:test";
import { matchesSearch, parseSettingsHash, searchWords, settingsHash } from "./settingsSearch.ts";

describe("parseSettingsHash", () => {
  it("reads a page, the list, and leaves other fragments alone", () => {
    expect(parseSettingsHash("#settings/terminal")).toEqual({ page: "terminal" });
    expect(parseSettingsHash("#settings/remote-pcs")).toEqual({ page: "remote-pcs" });
    expect(parseSettingsHash("#settings")).toEqual({ page: null });
    expect(parseSettingsHash("#settings/")).toEqual({ page: null });
    expect(parseSettingsHash("#settings/file-viewer")).toEqual({ page: null });
    expect(parseSettingsHash("#auth=abc")).toBeNull();
    expect(parseSettingsHash("#settingsx")).toBeNull();
    expect(parseSettingsHash("")).toBeNull();
  });

  it("round-trips with settingsHash", () => {
    expect(parseSettingsHash(settingsHash("chat"))).toEqual({ page: "chat" });
    expect(parseSettingsHash(settingsHash(null))).toEqual({ page: null });
  });
});

describe("matchesSearch", () => {
  it("needs every word, in any of the texts, ignoring case and width", () => {
    const words = searchWords("  Font   SIZE ");
    expect(words).toEqual(["font", "size"]);
    expect(matchesSearch(words, ["Font size", null, "terminal"])).toBe(true);
    expect(matchesSearch(words, ["Font", undefined, "terminal family"])).toBe(false);
    expect(matchesSearch(searchWords("ｆｏｎｔ"), ["Chat font"])).toBe(true);
  });

  it("matches the shown language and the English keywords alike", () => {
    const texts = ["글자 크기", "", "terminal font size"];
    expect(matchesSearch(searchWords("글자"), texts)).toBe(true);
    expect(matchesSearch(searchWords("font"), texts)).toBe(true);
    expect(matchesSearch(searchWords("wheel"), texts)).toBe(false);
  });

  it("keeps everything for an empty search", () => {
    expect(matchesSearch(searchWords("   "), ["anything"])).toBe(true);
  });
});
