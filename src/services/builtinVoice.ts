/**
 * Pre-generated spoken guidance.
 *
 * These clips exist so the app can talk when it *cannot* reach a model — first
 * launch, and "nothing is connected". A spoken message telling you no provider
 * is connected obviously cannot be produced by a provider, so it ships in the
 * binary instead.
 *
 * Regenerate with: npm run voice:generate
 */

import cloudDisabled from "../assets/voice/male/cloud-disabled.wav";
import firstRunSetup from "../assets/voice/male/first-run-setup.wav";
import listening from "../assets/voice/male/listening.wav";
import noProvider from "../assets/voice/male/no-provider.wav";
import notUnderstood from "../assets/voice/male/not-understood.wav";
import offline from "../assets/voice/male/offline.wav";
import welcome from "../assets/voice/male/welcome.wav";

export type BuiltinClip =
  | "welcome"
  | "first-run-setup"
  | "no-provider"
  | "cloud-disabled"
  | "listening"
  | "not-understood"
  | "offline";

/**
 * Only the male set is generated today. The female set lives beside it in
 * assets/voice/female and can be swapped in once generated — do not import it
 * until the files exist, or the build fails on a missing module.
 */
const CLIPS: Record<BuiltinClip, string> = {
  welcome,
  "first-run-setup": firstRunSetup,
  "no-provider": noProvider,
  "cloud-disabled": cloudDisabled,
  listening,
  "not-understood": notUnderstood,
  offline,
};

let current: HTMLAudioElement | null = null;

/** Stop whatever built-in clip is playing. */
export function stopBuiltinVoice(): void {
  if (!current) return;
  current.pause();
  current.src = "";
  current = null;
}

/**
 * Play a built-in clip. Resolves when it finishes, or immediately if audio is
 * unavailable — guidance that fails to play must never block the UI behind it.
 */
export async function playBuiltinVoice(clip: BuiltinClip): Promise<void> {
  const src = CLIPS[clip];
  if (!src) return;
  stopBuiltinVoice();

  try {
    const audio = new Audio(src);
    current = audio;
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => resolve(), { once: true });
    });
  } catch {
    // Autoplay blocked or no output device — silence is an acceptable outcome.
  } finally {
    if (current?.src === src) current = null;
  }
}

/** Maps a provider failure to the clip that explains it, if one fits. */
export function clipForError(message: string): BuiltinClip | null {
  const text = message.toLowerCase();
  if (text.includes("no ai model is connected") || text.includes("no api key")) {
    return "no-provider";
  }
  if (text.includes("cloud processing")) return "cloud-disabled";
  if (text.includes("network") || text.includes("could not reach")) return "offline";
  return null;
}
