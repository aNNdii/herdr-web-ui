import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

import "./ChatPage.css";

import { useT } from "../../lib/i18n.ts";
import { CHAT_FONT_MAX, CHAT_FONT_MIN, CHAT_WIDTHS, chatFontSize, DEFAULT_SETTINGS, forgetPaneViews, QUICK_REPLIES_MAX, QUICK_REPLY_MAX_CHARS, useSettings } from "../../lib/settings.ts";
import { FontFamilyInput } from "./FontFamilyInput.tsx";
import { Segmented, SettingsGroup, SettingsRow, Stepper, Toggle, withKeys } from "./SettingsUi.tsx";

/** Settings → Chat: the lens panes open in, the conversation, the message box and the quick replies. */
export function ChatPage() {
  const { settings, update } = useSettings();
  const t = useT();
  const replies = settings.quickReplies;
  const move = (index: number, by: -1 | 1): void => {
    const next = [...replies];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to]!, next[index]!];
    update({ quickReplies: next });
  };
  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("Panes open in")} description={t("Auto: chat for agents on touch screens, else the terminal")} keywords="panes open in default view lens auto chat terminal" control={
          <Segmented label={t("Panes open in")} value={settings.defaultView} onChange={(defaultView) => {
            if (settings.defaultView === defaultView) return;
            // one choice for every pane: what each one remembered gives way to it
            forgetPaneViews();
            update({ defaultView });
          }} options={[{ value: "auto", label: t("Auto") }, { value: "chat", label: t("Chat") }, { value: "terminal", label: t("Terminal") }]} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Conversation")}>
        <SettingsRow label={t("Show thinking")} description={t("Include the agent's reasoning blocks")} keywords="show thinking reasoning" control={
          <Toggle label={t("Show thinking")} checked={settings.showThinking} onChange={(showThinking) => update({ showThinking })} />
        } />
        <SettingsRow label={t("Width on large screens")} keywords="chat width narrow default wide full large screen" control={
          <Segmented label={t("Chat width")} value={settings.chatWidth} onChange={(chatWidth) => update({ chatWidth })}
            options={CHAT_WIDTHS.map((width) => ({ value: width, label: t(width === "narrow" ? "Narrow" : width === "wide" ? "Wide" : width === "full" ? "Full" : "Default") }))} />
        } />
        <SettingsRow label={t("Font size")} keywords="chat font size text messages" control={
          <Stepper label={t("Chat font size")} value={chatFontSize(settings)} display={`${chatFontSize(settings)} px`} min={CHAT_FONT_MIN} max={CHAT_FONT_MAX}
            decreaseLabel={t("Decrease chat font size")} increaseLabel={t("Increase chat font size")} onChange={(size) => update({ chatFontSize: size })} />
        } />
        <SettingsRow label={t("Font")} description={t("Message text only; code stays monospace")} keywords="chat font family typeface" stack control={
          <FontFamilyInput value={settings.chatFontFamily} label={t("Chat font")} onCommit={(chatFontFamily) => update({ chatFontFamily })} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Message box")}>
        <SettingsRow label={t("Enter sends")} description={withKeys(t("When off, {keys} sends"), ["Mod", "Enter"])} keywords="enter sends mod ctrl cmd enter composer message box" control={
          <Toggle label={t("Enter sends")} checked={settings.enterSends} onChange={(enterSends) => update({ enterSends })} />
        } />
        <SettingsRow label={t("Suggested prompt chip")} description={withKeys(t("On touch screens, puts Claude Code's suggested prompt in the box. With a keyboard, {keys} does it."), ["Tab"])} keywords="suggestion suggested prompt chip claude code tab" control={
          <Toggle label={t("Suggested prompt chip")} checked={settings.showSuggestionChip} onChange={(showSuggestionChip) => update({ showSuggestionChip })} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Quick replies")} intro={t("One-tap messages above the message box, sent as if typed: queued while the agent works, an answer when a question is open.")}
        actions={<>
          <button type="button" className="btn btn-secondary" disabled={replies.length >= QUICK_REPLIES_MAX} onClick={() => update({ quickReplies: [...replies, ""] })}><Plus aria-hidden="true" />{t("Add reply")}</button>
          <button type="button" className="btn btn-tertiary" onClick={() => update({ quickReplies: [...DEFAULT_SETTINGS.quickReplies] })}>{t("Restore defaults")}</button>
        </>}>
        <SettingsRow label={t("Show quick replies")} keywords="quick replies show above message box" control={
          <Toggle label={t("Show quick replies")} checked={settings.showQuickReplies} onChange={(showQuickReplies) => update({ showQuickReplies })} />
        } />
        {replies.length > 0 && <SettingsRow keywords="quick replies edit reorder remove add restore" stack control={
          <ol className="quick-replies-list">
            {replies.map((reply, index) => (
              <li key={index}>
                <input
                  className="input"
                  value={reply}
                  maxLength={QUICK_REPLY_MAX_CHARS}
                  aria-label={t("Quick reply {number}", { number: index + 1 })}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => update({ quickReplies: replies.map((current, at) => at === index ? event.target.value : current) })}
                />
                <button type="button" className="icon-button" aria-label={t("Move quick reply {number} up", { number: index + 1 })} title={t("Move quick reply {number} up", { number: index + 1 })} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></button>
                <button type="button" className="icon-button" aria-label={t("Move quick reply {number} down", { number: index + 1 })} title={t("Move quick reply {number} down", { number: index + 1 })} disabled={index === replies.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></button>
                <button type="button" className="icon-button" aria-label={t("Remove quick reply {number}", { number: index + 1 })} title={t("Remove quick reply {number}", { number: index + 1 })} onClick={() => update({ quickReplies: replies.filter((_, at) => at !== index) })}><X aria-hidden="true" /></button>
              </li>
            ))}
          </ol>
        } />}
      </SettingsGroup>
    </>
  );
}
