interface ModelOverviewCardProps {
  total: number;
  cloud: number;
  local: number;
  audio: number;
  vision: number;
  onConfigureProviders: () => void;
}

export function ModelOverviewCard({
  total,
  cloud,
  local,
  audio,
  vision,
  onConfigureProviders,
}: ModelOverviewCardProps) {
  const safe = Math.max(total, 1);
  const segments = [
    { key: "cloud", value: cloud, color: "rgba(156, 105, 255, 0.85)" },
    { key: "local", value: local, color: "rgba(110, 168, 255, 0.85)" },
    { key: "audio", value: audio, color: "rgba(90, 200, 210, 0.8)" },
    { key: "vision", value: vision, color: "rgba(130, 140, 155, 0.75)" },
  ];
  let cursor = 0;
  const stops = segments
    .map((seg) => {
      const start = (cursor / safe) * 100;
      cursor += seg.value;
      const end = (cursor / safe) * 100;
      return `${seg.color} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <section className="models-side-card models-side-card-overview">
      <header className="models-side-card-head">
        <h3 className="models-side-label">Model Overview</h3>
        <p className="models-side-subtitle">
          Catalog mix across cloud, local, audio, and vision-capable models.
        </p>
      </header>
      <div className="models-overview">
        <div
          className="models-donut"
          style={{ background: `conic-gradient(${stops})` }}
          aria-hidden="true"
        >
          <div className="models-donut-hole">
            <strong>{total}</strong>
            <span>Models</span>
          </div>
        </div>
        <ul className="models-overview-legend">
          <li>
            <span className="swatch cloud" /> Cloud <em>{cloud}</em>
          </li>
          <li>
            <span className="swatch local" /> Local <em>{local}</em>
          </li>
          <li>
            <span className="swatch audio" /> Audio <em>{audio}</em>
          </li>
          <li>
            <span className="swatch vision" /> Vision <em>{vision}</em>
          </li>
        </ul>
      </div>
      <p className="models-overview-footnote">
        Assign roles above, then set fallbacks so chat keeps working when a provider is down.
      </p>
      <button type="button" className="btn models-configure-providers" onClick={onConfigureProviders}>
        Configure providers
      </button>
    </section>
  );
}
