import { useEffect, useState } from "react";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { Dropdown } from "../../components/settings/Dropdown";
import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import {
  checkPocketTts,
  ensurePocketTtsRuntime,
  getPocketTtsRuntimeStatus,
  getPocketTtsVoicePreference,
  mapRuntimePhase,
  POCKET_TTS_VOICES,
  setPocketTtsVoicePreference,
  speakWithPocketTts,
  stopPocketTtsPlayback,
  type PocketTtsStatus,
} from "../../services/PocketTtsService";

/**
 * Voice Lab — tests Kyutai Pocket TTS raw voices only (no AI model required).
 * Independent of the character voice picked in Settings → Voice — the overlay
 * always speaks with the selected character's voice, not this lab preference.
 */
export function VoiceLabSettingsPage() {
  const [draft, setDraft] = useState(
    "Hello — this is Jane speaking through Pocket TTS on your computer.",
  );
  const [voice, setVoice] = useState(getPocketTtsVoicePreference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsStatus, setTtsStatus] = useState<PocketTtsStatus>("unknown");
  const [statusMessage, setStatusMessage] = useState(
    "Preparing Pocket TTS…",
  );
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const runtime = await getPocketTtsRuntimeStatus();
        if (cancelled) return;
        setTtsStatus(mapRuntimePhase(runtime.phase, runtime.online));
        setStatusMessage(runtime.message);
      } catch {
        if (!cancelled) {
          const ok = await checkPocketTts();
          if (!cancelled) {
            setTtsStatus(ok ? "online" : "offline");
            setStatusMessage(
              ok
                ? "Pocket TTS is online."
                : "Could not reach the Pocket TTS manager.",
            );
          }
        }
      }
    };

    const boot = async () => {
      setTtsStatus("installing");
      setStatusMessage(
        "Setting up Pocket TTS for ArcSonare (pip install on first use)…",
      );
      try {
        const runtime = await ensurePocketTtsRuntime();
        if (cancelled) return;
        setTtsStatus(mapRuntimePhase(runtime.phase, runtime.online));
        setStatusMessage(runtime.message);
      } catch (err) {
        if (cancelled) return;
        setTtsStatus("offline");
        setError(err instanceof Error ? err.message : String(err));
        setStatusMessage("Pocket TTS could not start.");
      }
    };

    void boot();
    const id = window.setInterval(() => {
      void refresh();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopPocketTtsPlayback();
    };
  }, []);

  const speak = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setSpeaking(true);
    try {
      let online = await checkPocketTts();
      if (!online) {
        setTtsStatus("starting");
        setStatusMessage("Starting Pocket TTS…");
        const runtime = await ensurePocketTtsRuntime();
        setTtsStatus(mapRuntimePhase(runtime.phase, runtime.online));
        setStatusMessage(runtime.message);
        online = runtime.online || (await checkPocketTts());
      }
      if (!online) {
        throw new Error(
          "Pocket TTS is still offline. Install Python 3.10–3.14 from python.org if needed, then try Speak again. ArcSonare installs Pocket TTS automatically with pip — no uvx or terminal serve command.",
        );
      }
      setTtsStatus("online");
      await speakWithPocketTts(text, { voice });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpeaking(false);
      setBusy(false);
    }
  };

  const statusLabel =
    ttsStatus === "online"
      ? "online at :8000"
      : ttsStatus === "installing"
        ? "installing…"
        : ttsStatus === "starting"
          ? "starting…"
          : "offline";

  return (
    <div className="page voice-lab-page">
      <SettingsPageHeader
        title="Voice Lab"
        description="Test raw Pocket TTS voices directly — separate from the character voice used in the overlay. ArcSonare installs and runs Pocket TTS for you."
      />

      <div className="voice-lab-shell">
        <header className="voice-lab-hero">
          <SonareMarbleOrb
            status={speaking ? "responding" : busy ? "thinking" : "idle"}
            size={72}
            tint="pearl"
          />
          <div className="voice-lab-hero-copy">
            <h2 className="voice-lab-name">Pocket TTS</h2>
            <p className="voice-lab-sub">
              Server {statusLabel} · Voice {voice}
            </p>
            <p className="voice-lab-hint">{statusMessage}</p>
          </div>
        </header>

        <div className="voice-lab-test">
          <p className="voice-lab-test-label">Voice</p>
          <Dropdown
            options={POCKET_TTS_VOICES.map((v) => ({
              value: v.id,
              label: v.label,
            }))}
            value={voice}
            onChange={(next) => {
              setVoice(next);
              setPocketTtsVoicePreference(next);
            }}
            ariaLabel="Pocket TTS voice"
          />

          <p className="voice-lab-test-label" style={{ marginTop: 12 }}>
            Text to speak
          </p>
          <form
            className="voice-lab-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void speak();
            }}
          >
            <input
              className="voice-lab-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type anything to hear with Pocket TTS…"
              disabled={busy}
              aria-label="Text to speak"
            />
            <button
              type="submit"
              className="voice-lab-send"
              disabled={busy || !draft.trim()}
            >
              {busy
                ? ttsStatus === "installing"
                  ? "Installing…"
                  : ttsStatus === "starting"
                    ? "Starting…"
                    : "…"
                : "Speak"}
            </button>
          </form>
          {error ? (
            <p className="voice-lab-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
