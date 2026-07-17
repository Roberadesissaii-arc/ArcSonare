/**
 * Wake-word engine contract.
 *
 * No wake-word engine ships in this phase. The interface exists so the
 * settings UI, persistence and future local engine share one shape; the
 * default implementation reports "not-configured" honestly and never opens
 * the microphone.
 */

export type WakeWordEngineStatus = "not-configured" | "ready" | "listening" | "error";

export interface WakeWordTestResult {
  detected: boolean;
  message: string;
}

export interface WakeWordService {
  /** Current engine status. "not-configured" until a local engine exists. */
  status(): WakeWordEngineStatus;
  /** Human-readable status line for the settings page. */
  statusText(): string;
  /** Begins listening for the phrase. Rejects when no engine is configured. */
  start(phrase: string, sensitivity: number): Promise<void>;
  stop(): Promise<void>;
  /**
   * Test workflow: resolves with the detection outcome or rejects when no
   * engine is configured. Implementations must release the microphone on
   * completion and on cancel.
   */
  test(phrase: string, signal: AbortSignal): Promise<WakeWordTestResult>;
}

/** The honest default: no engine is installed. */
class UnconfiguredWakeWordService implements WakeWordService {
  status(): WakeWordEngineStatus {
    return "not-configured";
  }
  statusText(): string {
    return "Engine not configured — no wake-word engine is installed in this build.";
  }
  start(): Promise<void> {
    return Promise.reject(
      new Error("No wake-word engine is configured. The wake phrase is not active."),
    );
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  test(): Promise<WakeWordTestResult> {
    return Promise.reject(
      new Error("No wake-word engine is configured, so the phrase cannot be tested yet."),
    );
  }
}

export const wakeWordService: WakeWordService = new UnconfiguredWakeWordService();
