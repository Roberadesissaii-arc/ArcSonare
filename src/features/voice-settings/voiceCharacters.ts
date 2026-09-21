import type { MarbleTint } from "../../components/voice/SonareMarbleOrb";

/**
 * ArcSonare voice characters (personalities).
 * Each character maps to a distinct provider voice for live preview + overlay speech.
 */
export interface VoiceCharacter {
  id: string;
  displayName: string;
  personality: string;
  description: string;
  marbleTint: MarbleTint;
  sampleGreeting: string;
  /** OpenAI Realtime voice id used for preview and overlay replies. */
  preferredProviderVoiceId: string;
}

export const VOICE_CHARACTERS: VoiceCharacter[] = [
  {
    id: "sonare",
    displayName: "Sonare",
    personality: "Default",
    description: "The signature ArcSonare voice. Calm and clear.",
    marbleTint: "violet",
    sampleGreeting:
      "Hello, I’m Sonare — your calm ArcSonare assistant. Ready when you are.",
    preferredProviderVoiceId: "marin",
  },
  {
    id: "vela",
    displayName: "Vela",
    personality: "Warm",
    description: "Soft and friendly for long sessions.",
    marbleTint: "warm",
    sampleGreeting:
      "Hi there — I’m Vela. Soft, friendly, and here for the long haul.",
    preferredProviderVoiceId: "coral",
  },
  {
    id: "orion",
    displayName: "Orion",
    personality: "Professional",
    description: "Grounded and precise for briefings.",
    marbleTint: "blue",
    sampleGreeting:
      "Good day. I’m Orion. Concise briefings and clear next steps.",
    preferredProviderVoiceId: "cedar",
  },
  {
    id: "lyra",
    displayName: "Lyra",
    personality: "Energetic",
    description: "Bright and articulate for quick answers.",
    marbleTint: "teal",
    sampleGreeting:
      "Hey! I’m Lyra — bright, quick, and ready with a sharp answer.",
    preferredProviderVoiceId: "shimmer",
  },
  {
    id: "nova",
    displayName: "Nova",
    personality: "Expressive",
    description: "Lively and expressive for casual chats.",
    marbleTint: "rose",
    sampleGreeting:
      "Hi — Nova here. Lively, expressive, and happy to chat.",
    preferredProviderVoiceId: "verse",
  },
  {
    id: "jane",
    displayName: "Jane",
    personality: "Conversational",
    description: "Natural conversation voice.",
    marbleTint: "pearl",
    sampleGreeting:
      "Hi — I’m Jane. Clear conversational speech for everyday talk.",
    preferredProviderVoiceId: "alloy",
  },
];

export function characterById(id: string | null | undefined): VoiceCharacter {
  return VOICE_CHARACTERS.find((c) => c.id === id) ?? VOICE_CHARACTERS[0];
}

export const PREVIEW_SAMPLES: {
  id: string;
  label: string;
  text: (name: string) => string;
}[] = [
  {
    id: "greeting",
    label: "Greeting",
    text: (name) => `Hello, I’m ${name}.`,
  },
  {
    id: "briefing",
    label: "Professional briefing",
    text: () =>
      "Here’s a concise briefing of what needs your attention today.",
  },
  {
    id: "friendly",
    label: "Friendly response",
    text: () =>
      "Sure — I can help with that. What would you like to do next?",
  },
  {
    id: "task",
    label: "Task confirmation",
    text: () =>
      "Done. I’ve saved that task and can remind you when it’s due.",
  },
];
