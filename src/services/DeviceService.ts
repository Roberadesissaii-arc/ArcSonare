/**
 * Real audio-device enumeration and microphone testing via WebRTC
 * (navigator.mediaDevices inside WebView2). No fake devices: when
 * enumeration fails or permission is denied, the caller receives an error
 * and the UI says so.
 *
 * Microphone streams are always released: `startLevelMeter` returns a stop
 * function that stops every track and closes the analyser.
 */

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
  isDefault: boolean;
}

export interface DeviceList {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

/**
 * Lists input/output devices. Device labels require microphone permission;
 * `requestPermission` asks once (and immediately releases the stream).
 */
export async function listAudioDevices(options?: {
  requestPermission?: boolean;
}): Promise<DeviceList> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Audio device enumeration is not available on this system.");
  }
  if (options?.requestPermission) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Permission denied — enumeration still works but labels are empty.
    }
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const map = (kind: "audioinput" | "audiooutput"): AudioDevice[] =>
    devices
      .filter((d) => d.kind === kind)
      .map((d, index) => ({
        deviceId: d.deviceId,
        label:
          d.label ||
          (d.deviceId === "default"
            ? "System default"
            : `${kind === "audioinput" ? "Microphone" : "Speaker"} ${index + 1}`),
        kind,
        isDefault: d.deviceId === "default",
      }));
  return { inputs: map("audioinput"), outputs: map("audiooutput") };
}

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

export async function microphonePermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state as MicPermission;
  } catch {
    return "unknown";
  }
}

export interface LevelMeterHandle {
  /** Stops the meter and releases the microphone. Idempotent. */
  stop: () => void;
}

/**
 * Opens the selected microphone and reports its RMS level (0..1) via
 * `onLevel` about 20×/second until stopped.
 */
export async function startLevelMeter(
  deviceId: string,
  constraints: {
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
  },
  onLevel: (level: number) => void,
): Promise<LevelMeterHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not available on this system.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
      noiseSuppression: constraints.noiseSuppression,
      echoCancellation: constraints.echoCancellation,
      autoGainControl: constraints.autoGainControl,
    },
  });

  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);

  let stopped = false;
  const interval = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);
    onLevel(Math.min(1, rms * 4));
  }, 50);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
    stream.getTracks().forEach((t) => t.stop());
    void audio.close().catch(() => undefined);
  };

  return { stop };
}
