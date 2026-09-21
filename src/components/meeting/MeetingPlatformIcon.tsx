/**
 * Meeting platform icons, from ArcSonare's own integration assets.
 *
 * These used to be hand-drawn SVG approximations of each brand — Webex was the
 * letters "Wx" on a blue square — while the real artwork sat unused in
 * `src/assets/icons/integrations`, where Connect and Applications have always
 * read it from. Two sets of icons for the same products is one set too many,
 * and the drawn ones were the wrong ones.
 *
 * The markup mirrors Connect's: the same `integration-icon-<id>` slot class and
 * the same `<img>`, so a platform looks the same wherever ArcSonare shows it.
 */

import {
  FRAMED_INTEGRATION_IDS,
  integrationIcons,
  type IntegrationId,
} from "../../config/iconRegistry";
import type { MeetingSourceId } from "../../features/meeting/meetingTypes";

interface Props {
  source: MeetingSourceId;
  /** Artwork size. The slot around it is sized by CSS. */
  size?: number;
  className?: string;
}

/**
 * Meeting sources that have real integration artwork.
 *
 * Webex is deliberately absent: the repository has no Cisco Webex asset, and
 * inventing one or fetching it from the network would put artwork nobody
 * reviewed into the product. It falls through to the neutral badge below, which
 * says "a meeting application" rather than claiming to be a brand.
 */
const INTEGRATION_FOR_SOURCE: Partial<Record<MeetingSourceId, IntegrationId>> = {
  zoom: "zoom",
  teams: "teams",
  "google-meet": "googleMeet",
  discord: "discord",
  slack: "slack",
};

/** The initial shown when a platform has no artwork of its own. */
const FALLBACK_INITIAL: Partial<Record<MeetingSourceId, string>> = {
  webex: "W",
  "generic-browser": "B",
  manual: "M",
};

export function MeetingPlatformIcon({ source, size = 20, className }: Props) {
  const integration = INTEGRATION_FOR_SOURCE[source];

  if (integration && integrationIcons[integration]) {
    return (
      <span
        className={`mi-platform-icon integration-icon-${integration}${
          FRAMED_INTEGRATION_IDS.has(integration) ? " is-framed" : ""
        } ${className ?? ""}`}
      >
        <img
          src={integrationIcons[integration]}
          alt=""
          width={size}
          height={size}
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      className={`mi-platform-icon mi-platform-icon-fallback ${className ?? ""}`}
      aria-hidden="true"
    >
      <span style={{ fontSize: Math.round(size * 0.55) }}>
        {FALLBACK_INITIAL[source] ?? "•"}
      </span>
    </span>
  );
}

/** Whether a source renders real brand artwork rather than the fallback. */
export function hasBrandArtwork(source: MeetingSourceId): boolean {
  const integration = INTEGRATION_FOR_SOURCE[source];
  return Boolean(integration && integrationIcons[integration]);
}
