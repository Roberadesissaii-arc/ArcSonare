import { InteractiveGlobe } from "./InteractiveGlobe";

interface ArcSonareCoreProps {
  size?: number;
  active?: boolean;
  paused?: boolean;
}

/** Central orbital core — compact dotted globe. */
export function ArcSonareCore({
  size = 168,
  active = false,
  paused = false,
}: ArcSonareCoreProps) {
  return (
    <div className="arc-core arc-core-globe" style={{ width: size, height: size }}>
      <InteractiveGlobe size={size} active={active} paused={paused} />
    </div>
  );
}
