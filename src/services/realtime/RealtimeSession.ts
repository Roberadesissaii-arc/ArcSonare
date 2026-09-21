/**
 * OpenAI Realtime speech-to-speech session over WebRTC.
 *
 * Audio in, audio out, tool calls in between — the model hears the user,
 * decides which ArcSonare capability to run, and speaks the answer itself.
 *
 * The API key never reaches this code. Rust mints a short-lived client secret
 * (`openai_realtime_client_secret`) and only that is used to open the call.
 */

import { invoke } from "@tauri-apps/api/core";
import type { EngineOptions } from "../../features/capabilities/capabilityEngine";
import { buildRealtimeTools } from "./realtimeToolSchemas";
import { getConnectedIntegrationIds } from "../integrationStatusService";
import { dispatchRealtimeToolCall } from "./realtimeTools";

/**
 * Connectors with a live credential, for the shared capability gate.
 *
 * A read failure yields an empty set rather than an exception: offering no
 * connector tools is a smaller error than offering tools that cannot run.
 */
async function connectedConnectorIds() {
  try {
    return await getConnectedIntegrationIds();
  } catch {
    return new Set<never>();
  }
}

/**
 * Watched applications that can supply tools to this voice session.
 *
 * Read from Rust rather than from any in-webview cache: the voice overlay runs
 * in `sonare-overlay`, a separate WebView2 heap, so the Dashboard's module
 * state is genuinely invisible here. A read failure yields none — offering no
 * watched-app tools is a smaller error than offering tools for an application
 * that is closed.
 */
async function liveWatchedApplicationsForSession() {
  try {
    const { refreshWatchSnapshot, liveWatchedApplications } = await import(
      "../../features/watch/watchStore"
    );
    await refreshWatchSnapshot();
    return liveWatchedApplications();
  } catch {
    return [];
  }
}
import { beginSession, endSession, isCurrent as guardIsCurrent } from "./sessionGuard";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/** Reasoning voice model. `low` effort is the documented default for agents. */
export const REALTIME_MODEL = "gpt-realtime-2.1";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "closed";

export interface RealtimeCallbacks {
  onStatus?: (status: RealtimeStatus) => void;
  /** Live transcript of what the user said. */
  onUserTranscript?: (text: string, final: boolean) => void;
  /** Live transcript of what the assistant is saying. */
  onAssistantTranscript?: (text: string, final: boolean) => void;
  /** A capability finished; `display` is the human-readable result. */
  onToolResult?: (capabilityId: string, display: string) => void;
  onError?: (message: string) => void;
}

interface ClientSecret {
  value: string;
  expires_at?: number | null;
}

export class RealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private micStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private closed = false;
  /** This session's claim to act. See sessionGuard.ts for why a flag is not enough. */
  private readonly claim = beginSession();
  /** Tool call ids already executed, so a redelivery is a no-op. */
  private readonly handledCalls = new Set<string>();

  /**
   * May this session still cause something to happen?
   *
   * Checked before acting and again after every await. A session that is closed
   * — or that has been superseded by a newer one — may not reach a capability,
   * send a tool result, or restart recognition.
   */
  private isCurrent(): boolean {
    return !this.closed && guardIsCurrent(this.claim);
  }

  constructor(
    private readonly instructions: string,
    private readonly voice: string,
    private readonly engineOptions: EngineOptions,
    private readonly callbacks: RealtimeCallbacks = {},
  ) {}

  private status(status: RealtimeStatus): void {
    this.callbacks.onStatus?.(status);
  }

  /** Open the session. Resolves once audio is flowing both ways. */
  async connect(): Promise<void> {
    this.status("connecting");

    const secret = await invoke<ClientSecret>("openai_realtime_client_secret", {
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: this.instructions,
        audio: {
          input: { transcription: { model: "gpt-live-transcribe" } },
          output: { voice: this.voice },
        },
        // Lowest effort that still reasons — the documented starting point for
        // production voice agents. Raise only if tool selection degrades.
        reasoning: { effort: "low" },
        // The watched list comes from the Rust-owned store, so this window's
        // tool list matches the main window's — the overlay has its own JS heap
        // and cannot see the Dashboard's state any other way.
        tools: buildRealtimeTools(
          await connectedConnectorIds(),
          await liveWatchedApplicationsForSession(),
        ),
      },
    });

    // Ask the audio stack to cancel our own output before it reaches the
    // recogniser. Requesting is not the same as getting — WebView2 may ignore
    // any of these — so what the track actually settled on is logged rather
    // than assumed, and the turn-taking gate does not depend on it working.
    const { ECHO_CONSTRAINTS, describeAudioProcessing } = await import(
      "../voiceSession"
    );
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: ECHO_CONSTRAINTS,
    });
    console.info(
      "[ArcSonare] mic audio processing:",
      describeAudioProcessing(this.micStream),
    );

    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Remote audio: the assistant's voice.
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
    pc.ontrack = (event) => {
      if (this.audioEl) this.audioEl.srcObject = event.streams[0];
    };

    for (const track of this.micStream.getAudioTracks()) {
      pc.addTrack(track, this.micStream);
    }

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.addEventListener("message", (event) => {
      void this.handleEvent(event.data as string);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(`${CALLS_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.value}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp ?? "",
    });

    if (!response.ok) {
      const detail = response.status === 401 ? "session credential rejected" : `${response.status}`;
      throw new Error(`OpenAI refused the Realtime call (${detail}).`);
    }

    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    this.status("listening");
  }

  /** Send a typed message instead of speaking — used by the overlay test path. */
  sendText(text: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
  }

  private send(payload: unknown): void {
    if (this.dc?.readyState !== "open") return;
    if (!this.isCurrent()) return;
    this.dc.send(JSON.stringify(payload));
  }

  private async handleEvent(raw: string): Promise<void> {
    // A transcript or tool call belonging to a session that is no longer the
    // active one is discarded rather than acted on.
    if (!this.isCurrent()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(event.type ?? "");

    switch (type) {
      case "input_audio_buffer.speech_started":
        this.status("listening");
        return;

      case "conversation.item.input_audio_transcription.delta":
        this.callbacks.onUserTranscript?.(String(event.delta ?? ""), false);
        return;

      case "conversation.item.input_audio_transcription.completed":
        this.callbacks.onUserTranscript?.(String(event.transcript ?? ""), true);
        // Only show thinking after the user actually said something.
        if (String(event.transcript ?? "").trim()) {
          this.status("thinking");
        }
        return;

      case "response.output_audio_transcript.delta":
        this.status("speaking");
        this.callbacks.onAssistantTranscript?.(String(event.delta ?? ""), false);
        return;

      case "response.output_audio_transcript.done":
        this.callbacks.onAssistantTranscript?.(String(event.transcript ?? ""), true);
        return;

      case "response.function_call_arguments.done":
        await this.runToolCall(event);
        return;

      case "response.done":
        this.status("listening");
        return;

      case "error": {
        const err = event.error as { message?: string; code?: string } | undefined;
        const msg = err?.message ?? "Realtime session error.";
        // Soft / recoverable API noise — keep the session and mic alive.
        if (
          /invalid|tool|function|argument|rate.?limit|cancel|timeout|conversation_already/i.test(
            msg,
          )
        ) {
          console.warn("[ArcSonare] Realtime soft error:", msg);
          this.status("listening");
          return;
        }
        this.callbacks.onError?.(msg);
        this.status("error");
        return;
      }

      default:
        return;
    }
  }

  private async runToolCall(event: Record<string, unknown>): Promise<void> {
    const name = String(event.name ?? "");
    const callId = String(event.call_id ?? "");
    const args = String(event.arguments ?? "");
    if (!name || !callId) return;

    // The last gate before a capability runs. Everything after this point can
    // change the user's machine, so the session must still be the live one.
    if (!this.isCurrent()) return;

    // The same call delivered twice must not execute twice. The Realtime API
    // redelivers when an output is not acknowledged, and `tasks.create` is not
    // the only capability with a side effect.
    if (this.handledCalls.has(callId)) return;
    this.handledCalls.add(callId);

    this.status("thinking");
    const { output, display } = await dispatchRealtimeToolCall(name, args, this.engineOptions, callId);

    // Re-checked after the await: the overlay may have been dismissed while the
    // capability was running. Nothing further is spoken or sent.
    if (!this.isCurrent()) return;

    if (display) {
      this.callbacks.onToolResult?.(name.replace(/__/g, "."), display);
    }

    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    });
    // The model needs an explicit nudge to speak after a tool result.
    this.send({ type: "response.create" });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Retired as the very first act, so anything already inside an await fails
    // its next `isCurrent()` check rather than completing.
    endSession(this.claim);
    // Cancel any in-flight spoken response before tearing the peer down —
    // otherwise audio keeps playing after the overlay is dismissed.
    try {
      if (this.dc?.readyState === "open") {
        this.dc.send(JSON.stringify({ type: "response.cancel" }));
        this.dc.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
      }
    } catch {
      // ignore — channel may already be dead
    }
    try {
      if (this.audioEl) {
        this.audioEl.pause();
        this.audioEl.muted = true;
        const remote = this.audioEl.srcObject;
        if (remote instanceof MediaStream) {
          remote.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              // ignore
            }
          });
        }
        this.audioEl.srcObject = null;
        this.audioEl.removeAttribute("src");
        try {
          this.audioEl.load();
        } catch {
          // ignore
        }
      }
      this.pc?.getReceivers().forEach((r) => {
        try {
          r.track?.stop();
        } catch {
          // ignore
        }
      });
      this.pc?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {
          // ignore
        }
      });
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.dc?.close();
      this.pc?.close();
    } catch (err) {
      console.warn("[ArcSonare] Realtime close cleanup:", err);
    }
    this.dc = null;
    this.pc = null;
    this.micStream = null;
    this.audioEl = null;
    this.status("closed");
  }
}

/** True when an OpenAI key is stored, so the UI can explain what's missing. */
export async function realtimeConfigured(): Promise<boolean> {
  try {
    return await invoke<boolean>("openai_realtime_configured");
  } catch {
    return false;
  }
}
