import type { SoundProfileId } from "../../config/prefs";
import type { SoundProfileMeta } from "./soundTypes";

export const SOUND_PROFILES: SoundProfileMeta[] = [
  {
    id: "calm",
    label: "Calm",
    title: "Calm",
    description:
      "Softer attack and longer fade. Designed for long work sessions without fatigue.",
    warmthDots: 6,
    clarityDots: 3,
    presenceDots: 3,
    params: {
      attackMultiplier: 1.18,
      decayMultiplier: 1.16,
      brightness: 0.38,
      warmth: 0.74,
      presence: 0.36,
      stereoWidth: 0.4,
      reverbAmount: 0.12,
      gainMultiplier: 0.88,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    title: "Balanced",
    description:
      "A refined balance of warmth and clarity. Designed for focus without distraction.",
    warmthDots: 4,
    clarityDots: 5,
    presenceDots: 4,
    params: {
      attackMultiplier: 1,
      decayMultiplier: 1,
      brightness: 0.55,
      warmth: 0.56,
      presence: 0.52,
      stereoWidth: 0.48,
      reverbAmount: 0.1,
      gainMultiplier: 1,
    },
  },
  {
    id: "crisp",
    label: "Crisp",
    title: "Crisp",
    description:
      "Faster attack and higher clarity. Immediate feedback that stays restrained.",
    warmthDots: 3,
    clarityDots: 7,
    presenceDots: 6,
    params: {
      attackMultiplier: 0.74,
      decayMultiplier: 0.78,
      brightness: 0.76,
      warmth: 0.38,
      presence: 0.68,
      stereoWidth: 0.42,
      reverbAmount: 0.05,
      gainMultiplier: 0.95,
    },
  },
  {
    id: "cinematic",
    label: "Cinematic",
    title: "Cinematic",
    description:
      "Fuller body and longer decay. Still soft — never game-like or distracting.",
    warmthDots: 5,
    clarityDots: 4,
    presenceDots: 6,
    params: {
      attackMultiplier: 1.04,
      decayMultiplier: 1.3,
      brightness: 0.5,
      warmth: 0.68,
      presence: 0.62,
      stereoWidth: 0.72,
      reverbAmount: 0.18,
      gainMultiplier: 0.94,
    },
  },
];

export function profileById(id: SoundProfileId): SoundProfileMeta {
  return SOUND_PROFILES.find((p) => p.id === id) ?? SOUND_PROFILES[1];
}
