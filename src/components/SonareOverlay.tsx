import { useOverlayLifecycle } from "../hooks/useOverlayLifecycle";
import { SonareOrb } from "./SonareOrb";
import { ShortcutHint } from "./ShortcutHint";
import { CloseButton } from "./CloseButton";

export function SonareOverlay() {
  const { phase, requestClose, handleAnimationEnd } = useOverlayLifecycle();

  return (
    <div className={`overlay-root phase-${phase}`}>
      <div className="capsule" onAnimationEnd={handleAnimationEnd}>
        <SonareOrb />
        <div className="identity">
          <span className="brand">ArcSonare</span>
          <span className="status">Ready</span>
        </div>
        <div className="spacer" />
        <ShortcutHint keys={["Ctrl", "Shift", "Space"]} />
        <CloseButton onClick={requestClose} />
      </div>
    </div>
  );
}
