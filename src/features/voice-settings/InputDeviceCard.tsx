import { MicIcon } from "../../components/Icons";
import type { AudioDevice, MicPermission } from "../../services/DeviceService";
import { VoiceDevicePicker } from "./VoiceDevicePicker";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

interface InputDeviceCardProps {
  devices: AudioDevice[];
  value: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
  level: number | null;
  permission: MicPermission;
  testing: boolean;
  error: string | null;
  deviceError: string | null;
  onToggleTest: () => void;
  onOpenWindows: () => void;
}

function levelStatus(level: number | null): { label: string; kind: string } {
  if (level === null) return { label: "No input", kind: "idle" };
  if (level < 0.08) return { label: "Low", kind: "low" };
  if (level > 0.85) return { label: "Too loud", kind: "hot" };
  return { label: "Good", kind: "good" };
}

export function InputDeviceCard({
  devices,
  value,
  onChange,
  onRefresh,
  level,
  permission,
  testing,
  error,
  deviceError,
  onToggleTest,
  onOpenWindows,
}: InputDeviceCardProps) {
  const options =
    devices.length > 0
      ? devices.map((d) => ({
          value: d.deviceId,
          label: d.isDefault ? `Default – ${d.label}` : d.label,
        }))
      : [{ value: "default", label: "No microphones found" }];

  const selected = devices.some((d) => d.deviceId === value) ? value : options[0].value;
  const status = levelStatus(level);
  const segments = 44;
  const lit = level === null ? 0 : Math.round(level * segments);

  return (
    <VoiceSettingsCard icon={<MicIcon size={15} />} title="Input" className="voice-input-card">
      <VoiceDevicePicker
        label="Microphone"
        icon={<MicIcon size={15} />}
        options={options}
        value={selected}
        onChange={onChange}
        onRefresh={onRefresh}
        ariaLabel="Microphone"
        refreshLabel="Refresh microphones"
      />

      <div className="voice-field">
        <div className="voice-field-label-row">
          <span className="voice-field-label">Input level</span>
          <span className={`voice-level-status is-${status.kind}`}>{status.label}</span>
        </div>
        <div
          className={`voice-input-meter${level === null ? " is-idle" : ""}`}
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level === null ? 0 : Math.round(level * 100)}
        >
          {Array.from({ length: segments }, (_, i) => (
            <span key={i} className={i < lit ? "is-lit" : undefined} />
          ))}
        </div>
      </div>

      <div className="voice-input-actions">
        <button
          type="button"
          className={`voice-solid-btn${testing ? " is-danger" : ""}`}
          onClick={onToggleTest}
        >
          <MicIcon size={14} />
          {testing ? "Stop test" : "Test microphone"}
        </button>
        <button type="button" className="voice-solid-btn is-secondary" onClick={onOpenWindows}>
          Open Windows settings
        </button>
      </div>
      <p className="voice-help">
        {testing
          ? "Listening… speak to check input. The microphone is released when you stop."
          : "Tap to start speaking and check input."}
        {permission === "denied"
          ? " Microphone permission is denied in Windows privacy settings."
          : ""}
      </p>
      {error || deviceError ? (
        <p className="voice-error" role="alert">
          {error || deviceError}
        </p>
      ) : null}
    </VoiceSettingsCard>
  );
}
