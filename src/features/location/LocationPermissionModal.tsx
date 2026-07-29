import { useState } from "react";
import {
  markLocationPrompted,
  requestDeviceLocation,
  setLocationPermission,
} from "../../services/LocationService";

interface LocationPermissionModalProps {
  open: boolean;
  onClose: () => void;
}

/** First-run prompt so weather / nearby / ETA can use the device location. */
export function LocationPermissionModal({
  open,
  onClose,
}: LocationPermissionModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const finish = () => {
    markLocationPrompted();
    onClose();
  };

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestDeviceLocation({ force: true });
      finish();
    } catch (err) {
      setLocationPermission("denied");
      setError(
        err instanceof Error
          ? err.message
          : "Location access was denied. You can enable it later in Settings.",
      );
      setBusy(false);
    }
  };

  const skip = () => {
    setLocationPermission("denied");
    finish();
  };

  return (
    <div className="modal-backdrop" onPointerDown={busy ? undefined : skip}>
      <div
        className="modal"
        role="dialog"
        aria-label="Location access"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title">Use your location?</h2>
        </div>
        <p className="modal-label" style={{ marginBottom: "0.75rem" }}>
          ArcSonare can check the weather where you are, find nearby places, and
          estimate travel time — only when you ask.
        </p>
        <p className="settings-muted" style={{ marginBottom: "1rem" }}>
          Your coordinates stay on this device. Weather and map lookups use
          anonymous location APIs; nothing is sold or shared as a profile.
        </p>
        {error ? (
          <p className="data-privacy-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={skip}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void allow()}
          >
            {busy ? "Checking…" : "Allow location"}
          </button>
        </div>
      </div>
    </div>
  );
}
