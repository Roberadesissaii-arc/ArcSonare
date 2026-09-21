import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  LayersIcon,
  PaperclipIcon,
  SearchIcon,
  SendIcon,
  SparkleIcon,
  MicIcon,
  StopIcon,
  ZapIcon,
} from "../Icons";
import { invoke } from "@tauri-apps/api/core";
import { SonareSparkle } from "../brand/SonareSparkle";
import { addActivity } from "../../stores/appStore";
import {
  clearCenterWork,
  setCenterView,
} from "../../stores/centerStageStore";
import {
  appendAssistantMessageChunk,
  pushPendingAssistantMessage,
  pushUserMessage,
  resolveAssistantMessage,
  setAssistantMessageStatus,
} from "../../stores/chatStore";
import { askAssistant } from "../../services/AssistantService";
import { getPrefs } from "../../stores/settingsStore";
import { getVoiceState, setVoiceStatus } from "../../stores/voiceStore";
import {
  startSpeechListening,
  stopSpeechListening,
} from "../../services/SpeechRecognitionService";
import { WatchComposerControl } from "../watch/WatchComposerControl";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const WAVEFORM_BARS = 20;

interface ComposerMode {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  comingLater?: boolean;
}

const MODES: ComposerMode[] = [
  {
    id: "smart",
    name: "Smart mode",
    description: "Uses DeepSeek for chat (Settings → Voice & AI keys)",
    icon: SparkleIcon,
  },
  {
    id: "fast",
    name: "Fast mode",
    description: "Prioritizes speed",
    icon: ZapIcon,
    comingLater: true,
  },
  {
    id: "reasoning",
    name: "Reasoning mode",
    description: "Uses deeper step-by-step planning",
    icon: LayersIcon,
    comingLater: true,
  },
  {
    id: "research",
    name: "Research mode",
    description: "Searches connected knowledge and sources",
    icon: SearchIcon,
    comingLater: true,
  },
];

function formatRecordingTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** Ask DeepSeek (chat) and show the exchange as a chat bubble. */
async function runAssistant(
  text: string,
  /** The user's own words — routing must ignore any mode instructions above. */
  intentText?: string,
) {
  const assistantId = pushPendingAssistantMessage();
  setCenterView("chat");
  setVoiceStatus("thinking");

  // Snapshot the count first: a turn that runs no tool records no provenance,
  // and attaching the previous answer's trace to it would make the diagnostics
  // lie about the very thing they exist to prove.
  const { getResponseProvenance } = await import(
    "../../features/capabilities/executionTrace"
  );
  const provenanceBefore = getResponseProvenance().length;

  try {
    const reply = await askAssistant(text, {
      intentText,
      onStatus: (status, capabilityId) =>
        setAssistantMessageStatus(assistantId, status, capabilityId),
      onChunk: (delta) => appendAssistantMessageChunk(assistantId, delta),
    });
    const provenance = getResponseProvenance();
    resolveAssistantMessage(assistantId, reply.text, {
      // Credited only when the watched context actually contributed. An
      // application that merely happened to be watched is not a source.
      watchedSources: reply.watchedSources,
      diagnostics:
        provenance.length > provenanceBefore
          ? provenance[provenance.length - 1]
          : undefined,
      // `source` is developer provenance and is not rendered; `resultSource` is
      // what the footer shows.
      source: { label: reply.sourceLabel, tool: reply.localTool },
      resultSource: reply.source,
      actions: reply.actions,
      results: reply.results,
      captureId: reply.captureId,
      images: reply.images,
    });
    addActivity(`ArcSonare: ${reply.text.slice(0, 120)}`, "agent");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The assistant did not reply.";
    resolveAssistantMessage(assistantId, message);
  } finally {
    if (getVoiceState().status === "thinking") {
      setVoiceStatus("idle");
    }
  }
}

/**
 * Bottom command composer. Smart mode uses DeepSeek for chat (Settings → Voice
 * & AI keys). Typed replies stay silent — speech only happens on the voice overlay.
 */
export function CommandComposer() {
  const [value, setValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ComposerMode>(MODES[0]);
  const [modeOpen, setModeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [reasoningActive, setReasoningActive] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const waveformBarRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!modeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!modeRef.current?.contains(event.target as Node)) setModeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModeOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modeOpen]);

  // Stop listening if the composer unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      stopSpeechListening();
      stopAudioMeter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (collapsed) return;
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            event.preventDefault();
            attachFile(file);
            break;
          }
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  const attachFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      console.error("[ArcSonare] attachment too large (max 10MB)");
      return;
    }
    setAttachedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setAttachedPreview((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    setAttachedPreview(null);
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) attachFile(file);
    event.target.value = "";
  };

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) attachFile(file);
  };

  const toggleSearch = () => {
    setSearchActive((v) => {
      const next = !v;
      if (next) setReasoningActive(false);
      return next;
    });
  };

  const toggleReasoning = () => {
    setReasoningActive((v) => {
      const next = !v;
      if (next) setSearchActive(false);
      return next;
    });
  };


  // "watch" is deliberately absent. It was never a composer *mode* — it came
  // from whether any application happened to be watched, which put a Watch chip
  // on messages the user never marked. Which application contributed to a turn
  // is reported on the message itself, from what the answer actually used.
  const activeMode = (): "search" | "reasoning" | undefined => {
    if (searchActive) return "search";
    if (reasoningActive) return "reasoning";
    return undefined;
  };

  /**
   * Each toggle changes what actually happens, not just the bubble label.
   * Search opens a real web search (web.search can open a query but cannot
   * read results back, so the model is told not to claim it browsed).
   * Watch steers the model toward apps the user activated in Running apps.
   */
  /**
   * Mode hints for the model. Keep them SHORT and never put long policy essays
   * in the user message — when the user asks “why?”, models explain those
   * instructions instead of the real outcome (Watch-mode prompt leak).
   */
  const applyMode = (
    text: string,
    activeToggle: ReturnType<typeof activeMode>,
  ): string => {
    switch (activeToggle) {
      case "reasoning":
        return `Think step by step briefly, then conclude.\n\n${text}`;
      default:
        return text;
    }
  };

  /** Drives the waveform bars from real mic input (separate stream from speech recognition). */
  const startAudioMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const bucketSize = Math.max(1, Math.floor(data.length / WAVEFORM_BARS));

      const tick = () => {
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < WAVEFORM_BARS; i++) {
          const start = i * bucketSize;
          let sum = 0;
          for (let j = start; j < start + bucketSize && j < data.length; j++) sum += data[j];
          const avg = sum / bucketSize;
          const pct = Math.max(12, Math.min(100, (avg / 255) * 100 + 12));
          const bar = waveformBarRefs.current[i];
          if (bar) bar.style.height = `${pct}%`;
        }
        meterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error("[ArcSonare] microphone level meter unavailable:", err);
    }
  };

  const stopAudioMeter = () => {
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  const stopRecording = () => {
    stopSpeechListening();
    stopAudioMeter();
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordSeconds(0);
  };

  const startRecording = () => {
    if (busy) return;
    const started = startSpeechListening({
      lang: getPrefs().general.voiceLanguage,
      onFinal: (text) => {
        setValue((current) => (current ? `${current} ${text}` : text));
      },
      onError: (message) => {
        console.error("[ArcSonare] composer voice input error:", message);
        stopRecording();
      },
    });
    if (!started) return;
    setIsRecording(true);
    setRecordSeconds(0);
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
    void startAudioMeter();
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && !attachedFile) || busy) return;
    if (isRecording) stopRecording();

    const activeToggle = activeMode();
    // The attachment is metadata on the bubble, not text glued onto the
    // message — the model still gets the filename so it can refer to it.
    const attachmentContext = attachedFile
      ? `\n\n(The user attached an image named "${attachedFile.name}".)`
      : "";
    const outgoingText = `${applyMode(text, activeToggle)}${attachmentContext}`;
    const attachmentMeta = attachedFile
      ? { name: attachedFile.name, dataUrl: attachedPreview ?? undefined }
      : undefined;

    addActivity(`You: "${text || attachedFile?.name}"`, "command");
    setValue("");
    removeAttachment();
    setSearchActive(false);
    setReasoningActive(false);
    // The Watch control is deliberately not reset here. It is a scope the user
    // set for the conversation, not a per-message mode: clearing it on send
    // would mean re-selecting the application before every follow-up.
    setBusy(true);

    const finish = () => setBusy(false);

    // Search mode opens a real web search alongside the answer. web.search can
    // launch a query but cannot read results, so the model is told as much and
    // must not claim it browsed anything.
    if (activeToggle === "search" && text) {
      void invoke("overlay_web_search", { query: text }).catch((err: unknown) => {
        console.error("[ArcSonare] composer web search failed:", err);
      });
    }

    // No watched-source badge on the outgoing message. It used to be stamped
    // from the active scope at send time, which was a guess made before the
    // prompt existed: "what's the weather?" carried a "Discord context" badge
    // while the relevance gate had correctly excluded Discord entirely. The
    // reply carries the badge instead, credited from what the prompt actually
    // contained.
    pushUserMessage(text || attachedFile?.name || "", {
      attachment: attachmentMeta,
      mode: activeToggle,
    });

    // A pasted URL still reaches `web.fetch_page` through the engine's
    // deterministic routing. That never needed a composer toggle, which is why
    // Browser mode was removed rather than replaced: its branch reduced to the
    // user's own text.
    const modelText =
      activeToggle === "search"
        ? `${outgoingText}\n\n(A web search for this was opened in the user's browser. You cannot read those results — answer from your own knowledge and do not claim to have browsed.)`
        : outgoingText;

    void runAssistant(modelText, text).finally(finish);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      textareaRef.current?.blur();
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="composer-collapsed"
        onClick={() => setCollapsed(false)}
        aria-label="Expand the command composer"
      >
        <SonareSparkle size={16} />
        <span>Ask ArcSonare anything...</span>
      </button>
    );
  }

  const hasContent = value.trim() !== "" || Boolean(attachedFile);
  const primaryAction = () => {
    if (isRecording) {
      stopRecording();
    } else if (hasContent) {
      submit();
    } else {
      startRecording();
    }
  };
  const primaryLabel = isRecording ? "Stop recording" : hasContent ? "Send" : "Voice input";
  const primaryDisabled = busy && !hasContent;

  return (
    <div className="composer" onDragOver={onDragOver} onDrop={onDrop}>
      {attachedPreview ? (
        <div className="composer-attachments">
          <div className="composer-attachment">
            <img src={attachedPreview} alt={attachedFile?.name ?? "Attached image"} />
            <button
              type="button"
              className="composer-attachment-remove"
              onClick={removeAttachment}
              aria-label="Remove attachment"
            >
              <CloseIcon size={11} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="composer-input-row">
        <span className="composer-spark" aria-hidden="true">
          <SonareSparkle size={22} />
        </span>

        {isRecording ? (
          <div className="composer-recording">
            <span className="composer-recording-dot" aria-hidden="true" />
            <span className="composer-recording-time">{formatRecordingTime(recordSeconds)}</span>
            <div className="composer-waveform" aria-hidden="true">
              {Array.from({ length: WAVEFORM_BARS }).map((_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    waveformBarRefs.current[i] = el;
                  }}
                  className="composer-waveform-bar"
                />
              ))}
            </div>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="composer-input"
            rows={1}
            value={value}
            placeholder={busy ? "ArcSonare is thinking…" : "Ask ArcSonare anything..."}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Ask ArcSonare"
            disabled={busy}
          />
        )}

        <button
          type="button"
          className="icon-button"
          onClick={() => {
            clearCenterWork();
            setCollapsed(true);
          }}
          aria-label="Close the composer"
          title="Close"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="composer-foot">
        <div className="composer-quick">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onFileInputChange}
          />
          <button
            type="button"
            className="composer-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || isRecording}
            aria-label="Attach an image"
            title="Attach an image"
          >
            <PaperclipIcon size={14} />
          </button>

          <span className="composer-divider" aria-hidden="true" />

          <button
            type="button"
            className={`toggle-pill toggle-pill-search${searchActive ? " active" : ""}`}
            onClick={toggleSearch}
            disabled={busy || isRecording}
            aria-pressed={searchActive}
            title="Open a web search for your message (does not read the page)"
          >
            <SearchIcon size={14} />
            <span className="toggle-pill-label">Search</span>
          </button>

          <span className="composer-divider" aria-hidden="true" />

          <button
            type="button"
            className={`toggle-pill${reasoningActive ? " active" : ""}`}
            onClick={toggleReasoning}
            disabled={busy || isRecording}
            aria-pressed={reasoningActive}
          >
            <LayersIcon size={14} />
            <span className="toggle-pill-label">Reasoning</span>
          </button>

          <span className="composer-divider" aria-hidden="true" />

          {/* Browser mode used to sit here. Traced by behaviour rather than by
              icon, it did nothing: its branch reduced to the user's own text,
              and `web.fetch_page` already routes deterministically on a pasted
              URL without any toggle. Search was kept because it has a real
              effect of its own — it opens a search in the user's browser
              without a model round-trip. Watch takes the freed slot. */}
          <WatchComposerControl disabled={busy || isRecording} />
        </div>
        <div className="composer-right">
          <div className="composer-mode" ref={modeRef}>
            <button
              type="button"
              className="mode-button"
              onClick={() => setModeOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={modeOpen}
            >
              {mode.name}
              <ChevronDownIcon size={13} />
            </button>
            {modeOpen ? (
              <ul className="mode-list" role="listbox" aria-label="Response mode">
                {MODES.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={m.id === mode.id}
                      className={`mode-option${m.id === mode.id ? " selected" : ""}`}
                      disabled={m.comingLater}
                      onClick={() => {
                        if (m.comingLater) return;
                        setMode(m);
                        setModeOpen(false);
                      }}
                    >
                      <span className="mode-option-icon">
                        <m.icon size={15} />
                      </span>
                      <span className="mode-option-meta">
                        <span className="mode-option-name">
                          {m.name}
                          {m.comingLater ? (
                            <span className="mode-option-soon">Coming later</span>
                          ) : null}
                        </span>
                        <span className="mode-option-desc">{m.description}</span>
                      </span>
                      {m.id === mode.id ? (
                        <span className="mode-option-check">
                          <CheckIcon size={14} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className={`composer-send${isRecording ? " recording" : ""}`}
            onClick={primaryAction}
            disabled={primaryDisabled}
            aria-label={primaryLabel}
            title={primaryLabel}
          >
            {isRecording ? (
              <StopIcon size={14} />
            ) : hasContent ? (
              <SendIcon size={15} />
            ) : (
              <MicIcon size={15} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
