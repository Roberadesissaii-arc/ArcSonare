import { RefreshIcon } from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import type { AudioDevice } from "../../services/DeviceService";

interface AudioDeviceSelectorProps {
  devices: AudioDevice[];
  value: string;
  onChange: (deviceId: string) => void;
  onRefresh: () => void;
  ariaLabel: string;
  error?: string | null;
}

/** Real audio-device dropdown with a refresh action. Never shows fake devices. */
export function AudioDeviceSelector({
  devices,
  value,
  onChange,
  onRefresh,
  ariaLabel,
  error,
}: AudioDeviceSelectorProps) {
  const options =
    devices.length > 0
      ? devices.map((d) => ({
          value: d.deviceId,
          label: d.isDefault ? `${d.label} (default)` : d.label,
        }))
      : [{ value: "default", label: "No devices found" }];

  return (
    <div className="device-selector">
      <Dropdown
        options={options}
        value={devices.some((d) => d.deviceId === value) ? value : options[0].value}
        onChange={onChange}
        ariaLabel={ariaLabel}
      />
      <button
        type="button"
        className="icon-button"
        onClick={onRefresh}
        aria-label={`Refresh ${ariaLabel}`}
        title="Refresh devices"
      >
        <RefreshIcon size={14} />
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
