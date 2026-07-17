import type { MarbleTint } from "../../components/voice/SonareMarbleOrb";

/**
 * ArcSonare voice characters (personalities). Distinct from provider TTS voices.
 * Portraits use tinted glass marbles matching the Live Assistant preview orb.
 */
export interface VoiceCharacter {
  id: string;
  displayName: string;
  personality: string;
  description: string;
  marbleTint: MarbleTint;
  sampleGreeting: string;
  preferredProviderVoiceId?: string;
}

export const VOICE_CHARACTERS: VoiceCharacter[] = [
  {
    id: "sonare",
    displayName: "Sonare",
    personality: "Default",
    description: "The signature ArcSonare voice. Calm and clear.",
    marbleTint: "violet",
    sampleGreeting: "Hello, I’m Sonare.",
  },
  {
    id: "vela",
    displayName: "Vela",
    personality: "Warm",
    description: "Soft and friendly for long sessions.",
    marbleTint: "warm",
    sampleGreeting: "Hi there — I’m Vela.",
  },
  {
    id: "orion",
    displayName: "Orion",
    personality: "Professional",
    description: "Grounded and precise for briefings.",
    marbleTint: "blue",
    sampleGreeting: "Good day. I’m Orion.",
  },
  {
    id: "lyra",
    displayName: "Lyra",
    personality: "Energetic",
    description: "Bright and articulate for quick answers.",
    marbleTint: "teal",
    sampleGreeting: "Hey! I’m Lyra.",
  },
  {
    id: "nova",
    displayName: "Nova",
    personality: "Expressive",
    description: "Lively and expressive for casual chats.",
    marbleTint: "rose",
    sampleGreeting: "Hi — Nova here.",
  },
];

export function characterById(id: string | null | undefined): VoiceCharacter {
  return VOICE_CHARACTERS.find((c) => c.id === id) ?? VOICE_CHARACTERS[0];
}

export const PREVIEW_SAMPLES: { id: string; label: string; text: (name: string) => string }[] = [
  {
    id: "greeting",
    label: "Greeting",
    text: (name) => `Hello, I’m ${name}.`,
  },
  {
    id: "briefing",
    label: "Professional briefing",
    text: () => "Here’s a concise briefing of what needs your attention today.",
  },
  {
    id: "friendly",
    label: "Friendly response",
    text: () => "Sure — I can help with that. What would you like to do next?",
  },
  {
    id: "task",
    label: "Task confirmation",
    text: () => "Done. I’ve saved that task and can remind you when it’s due.",
  },
];
