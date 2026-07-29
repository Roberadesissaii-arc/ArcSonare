import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CpuIcon,
  FolderIcon,
  LayersIcon,
  PaperclipIcon,
  SearchIcon,
  SendIcon,
  SparkleIcon,
  MicIcon,
  StopIcon,
  ZapIcon,
} from "../Icons";
import { SonareSparkle } from "../brand/SonareSparkle";
import { addActivity } from "../../stores/appStore";
import {
  clearCenterWork,
  completeCenterWork,
  setCenterView,
  startCenterWork,
} from "../../stores/centerStageStore";
import {
  appendAssistantMessageChunk,
  pushPendingAssistantMessage,
  pushUserMessage,
  resolveAssistantMessage,
} from "../../stores/chatStore";
import { askAssistant } from "../../services/AssistantService";
import { getPrefs } from "../../stores/settingsStore";
import { getVoiceState, setVoiceStatus } from "../../stores/voiceStore";
import {
  startSpeechListening,
  stopSpeechListening,
} from "../../services/SpeechRecognitionService";

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
    description: "Uses your default model from Settings → Models",
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
  {
    id: "local",
    name: "Local mode",
    description: "Always uses Ollama on this computer",
    icon: CpuIcon,
  },
];

function formatRecordingTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** Ask the selected default model (or force Ollama in Local mode) and show the exchange as a chat bubble. */
async function runAssistant(text: string, forceLocal: boolean) {
  const assistantId = pushPendingAssistantMessage();
  setCenterView("chat");
  setVoiceStatus("thinking");

  try {
    const reply = await askAssistant(text, {
      forceLocal,
      onChunk: (delta) => appendAssistantMessageChunk(assistantId, delta),
    });
    resolveAssistantMessage(assistantId, reply.text);
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
 * Bottom command composer. Smart mode uses your default model from
 * Settings → Models (same as the voice overlay). Local mode forces Ollama.
 * Typed replies stay silent — Pocket TTS only speaks on the voice overlay.
 */
export function CommandComposer() {
  const [value, setValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ComposerMode>(MODES[0]);
  const [modeOpen, setModeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [reasoningActive, setReasoningActive] = useState(false);
  const [canvasActive, setCanvasActive] = useState(false);
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

  const toggleCanvas = () => setCanvasActive((v) => !v);

  const activeModeNote = () => {
    if (searchActive) return "Search mode requested";
    if (reasoningActive) return "Reasoning mode requested";
    if (canvasActive) return "Canvas mode requested";
    return undefined;
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

    const contextNote = activeModeNote();
    const attachmentNote = attachedFile ? `\n\n[Attached image: ${attachedFile.name}]` : "";
    const outgoingText = `${text}${attachmentNote}`;

    addActivity(`You: "${text || attachedFile?.name}"`, "command");
    setValue("");
    removeAttachment();
    setSearchActive(false);
    setReasoningActive(false);
    setCanvasActive(false);
    setBusy(true);

    const lower = text.toLowerCase();

    const finish = () => setBusy(false);

    if (lower.startsWith("create a task") || lower.startsWith("create task")) {
      startCenterWork({
        kind: "create-task",
        title: "Creating task",
        status: "Preparing task form",
        step: text.replace(/^create (a )?task[:\s]*/i, "") || "New task",
        progress: 50,
        contextNote: "Task will be saved locally.",
        resultReady: false,
      });
      window.setTimeout(() => {
        completeCenterWork({
          status: "Open Tasks to finish creating this item.",
          step: "Task draft prepared locally.",
        });
        finish();
      }, 700);
      return;
    }

    // Everything else — including “hello” — uses the selected default model.
    const bubbleText = contextNote
      ? `${text || attachedFile?.name || ""}\n\n(${contextNote})`
      : text || attachedFile?.name || "";
    pushUserMessage(bubbleText);
    void runAssistant(outgoingText, mode.id === "local").finally(finish);
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

          <button
            type="button"
            className={`toggle-pill${searchActive ? " active" : ""}`}
            onClick={toggleSearch}
            disabled={busy || isRecording}
            aria-pressed={searchActive}
          >
            <SearchIcon size={14} />
            <span className="toggle-pill-label">Search</span>
          </button>

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

          <button
            type="button"
            className={`toggle-pill${canvasActive ? " active" : ""}`}
            onClick={toggleCanvas}
            disabled={busy || isRecording}
            aria-pressed={canvasActive}
          >
            <FolderIcon size={14} />
            <span className="toggle-pill-label">Canvas</span>
          </button>
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
