import { useEffect, useState } from "react";

import { fetchVoiceStatus, saveVoiceConfig } from "../../lib/api.ts";
import { useT } from "../../lib/i18n.ts";
import { useSettings } from "../../lib/settings.ts";
import { SHORTCUTS } from "../../lib/shortcuts.ts";
import { VOICE_CONFIG_EVENT } from "../../lib/voice.ts";
import type { VoiceStatus } from "../../../shared/voice.ts";
import { ServerTag, SettingsGroup, SettingsRow, SettingsTag, Toggle, withKeys } from "./SettingsUi.tsx";

const DICTATE_KEYS = SHORTCUTS.find((shortcut) => shortcut.id === "voice")!.keys;

/** Settings → Voice input: the mic button, who recognizes the speech, and the tidying of what was said. */
export function VoicePage() {
  const { settings, update } = useSettings();
  const t = useT();
  // the server only says whether it holds a key; the key typed here is never kept past a save
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [voiceKey, setVoiceKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  useEffect(() => { fetchVoiceStatus().then(setVoice, () => setVoice(null)); }, []);

  /** ask now, so the first dictation does not stop at the browser's permission prompt */
  const toggleVoiceInput = async (voiceInput: boolean) => {
    update({ voiceInput });
    setMicDenied(false);
    if (!voiceInput || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((track) => track.stop()); }
    catch { setMicDenied(true); }
  };
  const changeKey = async (api_key: string | null) => {
    setBusy(true);
    try {
      // the save answers the new status itself: no second request that could fail after it
      const saved = await saveVoiceConfig({ api_key });
      setVoiceKey("");
      setError(null);
      setVoice(saved);
      window.dispatchEvent(new Event(VOICE_CONFIG_EVENT));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("Microphone button")} description={withKeys(t("In the message box and the terminal input line. Hold {keys} to dictate."), DICTATE_KEYS)} keywords="microphone mic button voice input dictate speech" control={
          <Toggle label={t("Microphone button")} checked={settings.voiceInput} onChange={(voiceInput) => void toggleVoiceInput(voiceInput)} />
        }>
          {settings.voiceInput && !window.isSecureContext && <p className="settings-note is-error">{t("Voice input needs HTTPS")}</p>}
          {settings.voiceInput && window.isSecureContext && micDenied && <p className="settings-note is-error">{t("Microphone permission was denied")}</p>}
        </SettingsRow>
      </SettingsGroup>
      {voice && (
        <SettingsGroup title={t("Speech recognition")} intro={t("Nothing is recorded until you press the mic.")}>
          <SettingsRow label={t("Currently used")} keywords="speech recognition engine browser openai whisper privacy google microsoft"
            description={voice.configured ? t("Audio is sent to OpenAI with your key") : t("Chrome and Edge send the audio to Google or Microsoft")}
            control={<SettingsTag>{voice.configured ? t(voice.source === "env" ? "OpenAI key set by HERDR_WEB_OPENAI_API_KEY" : "OpenAI key saved on the server PC") : t("Browser recognition")}</SettingsTag>} />
          {voice.source !== "env" && (
            <SettingsRow label={t("OpenAI API key")} tag={<ServerTag />} description={t("With a key, audio goes to OpenAI instead of the browser")} keywords="openai api key whisper server save remove" stack control={
              <form className="settings-field-row" onSubmit={(event) => { event.preventDefault(); if (voiceKey.trim()) void changeKey(voiceKey.trim()); }}>
                <input
                  className="input"
                  type="password"
                  value={voiceKey}
                  placeholder="sk-..."
                  aria-label={t("OpenAI API key")}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => setVoiceKey(event.target.value)}
                />
                <button type="submit" className="btn btn-secondary" disabled={busy || !voiceKey.trim()}>{t("Save key")}</button>
                <button type="button" className="btn btn-tertiary" disabled={busy || !voice.configured} onClick={() => void changeKey(null)}>{t("Remove key")}</button>
              </form>
            }>
              {error && <p className="settings-note is-error" role="alert">{error}</p>}
            </SettingsRow>
          )}
        </SettingsGroup>
      )}
      {settings.voiceInput && (
        <SettingsGroup title={t("Tidy dictated text")} intro={t("Drops fillers and fixes spacing; code and paths stay as spoken")}>
          <SettingsRow label={t("In chat")} keywords="tidy dictated text chat polish fillers" control={
            <Toggle label={t("Tidy dictated text in chat")} checked={settings.voicePolishChat} onChange={(voicePolishChat) => update({ voicePolishChat })} />
          } />
          <SettingsRow label={t("In the terminal")} description={t("Off keeps a command exactly as transcribed")} keywords="tidy dictated text terminal polish command" control={
            <Toggle label={t("Tidy dictated text in the terminal")} checked={settings.voicePolishTerminal} onChange={(voicePolishTerminal) => update({ voicePolishTerminal })} />
          } />
        </SettingsGroup>
      )}
    </>
  );
}
