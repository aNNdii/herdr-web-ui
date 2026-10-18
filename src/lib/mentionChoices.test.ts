import { describe, expect, it } from "bun:test";

import type { SubagentMention } from "../../shared/protocol.ts";
import { mentionChoiceId, mentionChoices, mentionText } from "./mentionChoices.ts";
import { activeTrigger } from "./mentions.ts";

const explore: SubagentMention = { handle: "explore", description: "Fast codebase search" };
const plan: SubagentMention = { handle: "plan", description: "Plans an implementation" };
const general: SubagentMention = { handle: "general-purpose", description: "general-purpose" };
const agents = [general, explore, plan];

describe("mentionChoices", () => {
  it("puts agents before files for a leading @, filtered by the handle typed so far", () => {
    expect(mentionChoices(agents, [], activeTrigger("@", 1))).toEqual([general, explore, plan]);
    expect(mentionChoices(agents, ["explorer.ts"], activeTrigger("@ex", 3))).toEqual([explore, "explorer.ts"]);
    expect(mentionChoices(agents, [], activeTrigger("@PL", 3))).toEqual([plan]);
    expect(mentionChoices(agents, ["README.md"], activeTrigger("@zz", 3))).toEqual(["README.md"]);
  });

  it("offers only files further on in the message or for a path", () => {
    expect(mentionChoices(agents, ["src/a.ts"], activeTrigger("look @ex", 8))).toEqual(["src/a.ts"]);
    expect(mentionChoices(agents, ["src/a.ts"], activeTrigger("@src/", 5))).toEqual(["src/a.ts"]);
  });

  it("offers nothing without a file trigger", () => {
    expect(mentionChoices(agents, ["src/a.ts"], null)).toEqual([]);
    expect(mentionChoices(agents, ["src/a.ts"], activeTrigger("/re", 3))).toEqual([]);
  });
});

describe("mention choice identity and text", () => {
  it("keeps agent and file ids apart and inserts each as an @ token", () => {
    expect(mentionChoiceId(explore)).toBe("subagent:explore");
    expect(mentionChoiceId("src/a.ts")).toBe("src/a.ts");
    expect(mentionText(explore)).toBe("@explore ");
    expect(mentionText("src/a.ts")).toBe("@src/a.ts ");
  });
});
