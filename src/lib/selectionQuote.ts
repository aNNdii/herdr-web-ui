import { quoteFits, quoteIntoComposer } from "./chatQuote.ts";
import { composerDraftKey, composerDrafts } from "./composerDraft.ts";

/**
 * Quote beside the comment mode's Comment button (SelectionButton.tsx), for a selection in the chat's replies: in the
 * mode upstream's Quote/Comment pill (ReplyComments.tsx `ReplyCommentAction`) is not mounted, so the layer offers its
 * Quote through upstream's own helpers (lib/chatQuote.ts): the words go into the pane's draft as a `> ` quote, after
 * what it holds, and nothing is sent.
 */
export interface QuoteOffer {
  /** it fits in the pane's draft under the composer's limit as the offer is made; one that does not is refused, never cut */
  fits: boolean;
  /** puts it in the draft and hands the keyboard to the composer; false: it did not fit (any more), nothing changed */
  put(): boolean;
}

/** Quote's offer for `text` in the pane `paneKey` (its `paneStorageId`); null: no Quote (no pane to quote into, no words). */
export function quoteOffer(paneKey: string | null, text: string | null): QuoteOffer | null {
  if (paneKey === null || text === null || text.trim() === "") return null;
  return { fits: quoteFits(composerDrafts.read(composerDraftKey(paneKey)).text, text), put: () => quoteIntoComposer(paneKey, text) };
}
