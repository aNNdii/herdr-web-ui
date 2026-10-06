import { useEffect, useRef, useState } from "react";

import { FONT_FAMILY_MAX_CHARS, sanitizeFontFamily } from "../../lib/fontFamily.ts";

const FONT_FAMILY_PLACEHOLDER = 'D2Coding, "Cascadia Mono"';

/**
 * A font family list, saved when the field is left, on Enter or when the dialog closes: saving
 * every keystroke would sanitize away the comma or space being typed, and each change of the
 * terminal's font refits the grid and resizes the pane.
 */
export function FontFamilyInput({ value, label, mono = false, onCommit }: { value: string; label: string; mono?: boolean; onCommit: (family: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    const next = sanitizeFontFamily(draft);
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  // closing the dialog with Escape, or another page or a search taking this one's place, unmounts the field without a blur
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);
  return (
    <input
      className={`input settings-font-input${mono ? " is-mono" : ""}`}
      value={draft}
      placeholder={FONT_FAMILY_PLACEHOLDER}
      maxLength={FONT_FAMILY_MAX_CHARS}
      aria-label={label}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        // an IME keeps its Enter, including the committing one WebKit can send after compositionend as key code 229
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        commit();
      }}
    />
  );
}
