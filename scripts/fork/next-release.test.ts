import { describe, expect, it } from "bun:test";
import { latestNextTag, nextReleaseTag, releaseNotes } from "./next-release.ts";

describe("nextReleaseTag", () => {
  it("counts that upstream version's next releases from 1", () => {
    expect(nextReleaseTag("0.4.11", [])).toBe("v0.4.11-next.1");
    expect(nextReleaseTag("0.4.11", ["v0.4.11-next.1", "v0.4.11-next.3", "v0.4.10-next.7", "v0.4.11", "remote-v30"])).toBe("v0.4.11-next.4");
  });
  it("refuses a version that is not X.Y.Z", () => {
    expect(() => nextReleaseTag("0.4.11-beta", [])).toThrow();
  });
});

describe("latestNextTag", () => {
  it("orders by version, then by count", () => {
    expect(latestNextTag(["v0.3.49-next.1", "v0.4.9-next.2", "v0.4.10-next.1", "v0.4.9-next.10", "v0.5.0"])).toBe("v0.4.10-next.1");
    expect(latestNextTag(["v0.4.9-next.2", "v0.4.9-next.10"])).toBe("v0.4.9-next.10");
    expect(latestNextTag(["v0.4.11"])).toBeNull();
  });
});

describe("releaseNotes", () => {
  it("lists merged pull requests by title, the upstream syncs apart", () => {
    const notes = releaseNotes({
      tag: "v0.4.11-next.1", version: "0.4.11", previous: "v0.3.49-next.1", repo: "aNNdii/herdr-web-ui",
      commits: [
        { subject: "Merge pull request #22 from aNNdii/sync/upstream-main-next", body: "Merge upstream/main (0.4.11, 120 commits up to #1237) into next\n" },
        { subject: "Merge pull request #21 from aNNdii/feat/markdown-comments", body: "\nfeat(comments): comment on selected text\n\nmore\n" },
        { subject: "Merge pull request #20 from aNNdii/fix/x", body: "" },
        { subject: "docs: a direct commit", body: "" },
      ],
    });
    expect(notes).toBe([
      "Fork release of herdr web ui: upstream [v0.4.11](https://github.com/devswha/herdr-web-ui/releases/tag/v0.4.11) with the fork's features (`next`).",
      "",
      "### Upstream",
      "",
      "- Merge upstream/main (0.4.11, 120 commits up to #1237) into next (#22)",
      "",
      "### Fork",
      "",
      "- feat(comments): comment on selected text (#21)",
      "- aNNdii/fix/x (#20)",
      "- docs: a direct commit",
      "",
      "Changes since v0.3.49-next.1: https://github.com/aNNdii/herdr-web-ui/compare/v0.3.49-next.1...v0.4.11-next.1",
      "",
    ].join("\n"));
  });
});
