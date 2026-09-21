/**
 * Generates ArcSonare's built-in spoken guidance with Gemini TTS.
 *
 * These clips are the ones the app needs when it *cannot* talk to a model —
 * first launch, and "no provider connected". Generating them ahead of time is
 * the point: a message telling you nothing is connected cannot itself depend
 * on something being connected.
 *
 * Existing files are skipped, so a run that dies on a quota error resumes
 * where it stopped instead of burning quota regenerating what you already
 * have. Use --force to deliberately redo them.
 *
 * The API key is read from the environment and never stored in this repo:
 *
 *   cmd.exe     set GEMINI_API_KEY=your-key
 *   PowerShell  $env:GEMINI_API_KEY = "your-key"
 *
 *   npm run voice:generate                 # fill in whatever is missing
 *   npm run voice:generate -- --force      # regenerate everything
 *   npm run voice:generate -- --voice female
 *
 * Output: src/assets/voice/<male|female>/*.wav
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.1-flash-tts-preview";
const OUT_ROOT = resolve("src/assets/voice");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const ONLY_VOICE = args.includes("--voice")
  ? args[args.indexOf("--voice") + 1]
  : undefined;

/**
 * Gemini prebuilt voices. Both are on the calmer end deliberately — ArcSonare
 * is a desktop assistant, not an advertisement.
 */
const VOICES: { gender: "male" | "female"; voiceName: string }[] = [
  { gender: "male", voiceName: "Achird" }, // Friendly
  { gender: "female", voiceName: "Sulafat" }, // Warm
];

/** One shared persona so every clip sounds like the same assistant. */
function persona(gender: "male" | "female"): string {
  const who = gender === "male" ? "Adult male" : "Adult female";
  return `# AUDIO PROFILE: Sonare
## "The calm desktop assistant"

## THE SCENE
A quiet home office, mid-morning. Sonare speaks directly to one person sitting
at their computer. Nothing is urgent. There is no audience and no performance.

### DIRECTOR'S NOTES
Style: Warm, unhurried, and plain-spoken — a capable friend, not a narrator or
an advertisement. Never bright or salesy. No rising "customer service" lilt.
Pace: Relaxed and even. Short natural pauses at commas.
Accent: Neutral North American.
Voice: ${who}, mid-range, relaxed.

#### TRANSCRIPT
`;
}

const CLIPS: { name: string; text: string }[] = [
  {
    name: "welcome",
    text: "Welcome to ArcSonare. I'm Sonare, your voice assistant. Everything runs on this computer, and I'll only act when you ask.",
  },
  {
    name: "first-run-setup",
    text: "Before we start, open Settings, then Models, and connect the AI provider you want to use. Once that's done, I'm ready.",
  },
  {
    name: "no-provider",
    text: "I can't answer that yet — no AI model is connected. Open Settings, then Models, and connect the one you'd like me to use.",
  },
  {
    name: "cloud-disabled",
    text: "The model you picked needs cloud processing, and that's currently turned off. You can turn it on in Settings, under Data and Privacy.",
  },
  { name: "listening", text: "I'm listening." },
  {
    name: "not-understood",
    text: "Sorry, I didn't catch that. Could you say it again?",
  },
  {
    name: "offline",
    text: "I can't reach the network right now, so I'll stick to things I can do on this computer.",
  },
];

/** Gemini returns raw PCM; a WAV needs a 44-byte RIFF header in front of it. */
function toWav(pcm: Buffer, rate = 24000, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (rate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class QuotaError extends Error {}
/** 4xx that will never succeed on retry — a bad key, a bad request. */
class FatalError extends Error {}

async function requestAudio(text: string, voiceName: string): Promise<Buffer> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY as string,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
    },
  );

  if (res.status === 429) throw new QuotaError("quota exceeded");
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 120);
    // Waiting 65 seconds to retry an invalid API key helps nobody.
    if (res.status >= 400 && res.status < 500) {
      throw new FatalError(`Gemini returned ${res.status}: ${detail}`);
    }
    throw new Error(`Gemini returned ${res.status}: ${detail}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error("no audio returned (the model may have replied with text)");
  return toWav(Buffer.from(b64, "base64"));
}

/**
 * Retries transient failures. Quota (429) backs off progressively — free-tier
 * TTS quota is small and the whole set will not fit in one burst.
 */
async function generate(text: string, voiceName: string): Promise<Buffer> {
  const waits = [0, 20_000, 45_000];
  let last: unknown;
  for (const wait of waits) {
    if (wait) {
      process.stdout.write(`(waiting ${wait / 1000}s) `);
      await sleep(wait);
    }
    try {
      return await requestAudio(text, voiceName);
    } catch (err) {
      if (err instanceof FatalError) throw err;
      last = err;
      // A non-quota failure is usually the documented "returned text tokens"
      // case — retry immediately rather than sleeping 45s for nothing.
      if (!(err instanceof QuotaError)) {
        try {
          return await requestAudio(text, voiceName);
        } catch (second) {
          if (second instanceof FatalError) throw second;
          last = second;
        }
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Earlier runs wrote male clips flat in voice/. Move them into voice/male/. */
function migrateFlatFiles(): number {
  if (!existsSync(OUT_ROOT)) return 0;
  const maleDir = resolve(OUT_ROOT, "male");
  let moved = 0;
  for (const entry of readdirSync(OUT_ROOT)) {
    const from = resolve(OUT_ROOT, entry);
    if (!entry.endsWith(".wav") || !statSync(from).isFile()) continue;
    mkdirSync(maleDir, { recursive: true });
    renameSync(from, resolve(maleDir, entry));
    moved++;
  }
  return moved;
}

async function main() {
  if (!API_KEY) {
    console.error(
      "GEMINI_API_KEY is not set." +
        "\n\n  cmd.exe     set GEMINI_API_KEY=your-key" +
        '\n  PowerShell  $env:GEMINI_API_KEY = "your-key"' +
        "\n\n  then, in the same window:  npm run voice:generate",
    );
    process.exit(1);
  }

  const moved = migrateFlatFiles();
  if (moved) console.log(`moved ${moved} existing clip(s) into voice/male/\n`);

  const voices = ONLY_VOICE ? VOICES.filter((v) => v.gender === ONLY_VOICE) : VOICES;
  if (voices.length === 0) {
    console.error(`Unknown --voice "${ONLY_VOICE}". Use male or female.`);
    process.exit(1);
  }

  let made = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const { gender, voiceName } of voices) {
    const dir = resolve(OUT_ROOT, gender);
    mkdirSync(dir, { recursive: true });
    console.log(`${gender}  (${voiceName})`);

    for (const clip of CLIPS) {
      const path = resolve(dir, `${clip.name}.wav`);
      const label = `  ${clip.name}`.padEnd(22);

      // Already have it — don't spend quota regenerating.
      if (!FORCE && existsSync(path) && statSync(path).size > 1024) {
        console.log(`${label}skip (already generated)`);
        skipped++;
        continue;
      }

      process.stdout.write(label);
      try {
        const wav = await generate(persona(gender) + clip.text, voiceName);
        writeFileSync(path, wav);
        console.log(`OK  ${(wav.length / 1024).toFixed(0)} KB`);
        made++;
        await sleep(4000); // space requests; the free tier rejects bursts
      } catch (err) {
        const why =
          err instanceof QuotaError
            ? "quota exceeded"
            : err instanceof Error
              ? err.message
              : String(err);
        console.log(`FAILED  ${why}`);
        failures.push(`${gender}/${clip.name}`);
      }
    }
    console.log("");
  }

  console.log("-".repeat(70));
  console.log(`generated ${made}, skipped ${skipped}, failed ${failures.length}`);
  if (failures.length) {
    console.log(`still missing: ${failures.join(", ")}`);
    console.log("Run the same command again — finished clips are skipped.");
  }
  process.exit(failures.length ? 1 : 0);
}

void main();
