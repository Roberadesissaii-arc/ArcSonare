import type { SoundEvent, SoundProfileId } from "../../config/prefs";

export type { SoundEvent, SoundProfileId };

export interface SoundProfileParameters {
  attackMultiplier: number;
  decayMultiplier: number;
  brightness: number;
  warmth: number;
  presence: number;
  stereoWidth: number;
  reverbAmount: number;
  gainMultiplier: number;
}

export interface SoundProfileMeta {
  id: SoundProfileId;
  label: string;
  title: string;
  description: string;
  warmthDots: number;
  clarityDots: number;
  presenceDots: number;
  params: SoundProfileParameters;
}

export interface SoundPlaybackState {
  currentlyPreviewing: SoundEvent | null;
  previewAllActive: boolean;
  /** 0..1 amplitude hint for the circular visualizer. */
  amplitude: number;
}
