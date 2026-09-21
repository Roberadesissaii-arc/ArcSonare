/**
 * ArcSonare must not answer its own voice.
 *
 * It speaks through the speakers, the microphone hears it, the recogniser
 * transcribes it, and the assistant treats that as a new user request. Left
 * alone that is a loop, and the user watches a conversation they never had.
 *
 * The authoritative state machine is Rust (`src-tauri/src/voice_session.rs`,
 * tested there against real transitions). These checks cover the TypeScript
 * contract around it: that every transcript actually passes the gate, that
 * playback is bracketed even when it fails, and that no surface keeps its own
 * idea of who is speaking.
 *
 * Run: npx tsx scripts/check-voice-turns.mts
 */

import { readFileSync } from "node:fs";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const read = (p: string) => readFileSync(p, "utf8");

// --------------------------------------------- the recogniser goes through it
{
  const rec = read("src/services/SpeechRecognitionService.ts");
  check(
    "every final transcript passes the shared gate before becoming a request",
    rec.includes("considerTranscript(text)") &&
      rec.includes('disposition === "accepted"'),
    "onFinal is behind considerTranscript",
  );
  check(
    "a rejected transcript is reported rather than silently dropped",
    rec.includes("onSuppressed"),
    // "I ignored my own voice" and "I didn't hear you" are different things.
    "callers can say why nothing happened",
  );
  {
    // Scoped to the catch block itself: measuring "somewhere later in the file"
    // would pass on any file that happens to mention onFinal again.
    const catchStart = rec.indexOf(".catch(");
    const catchBody = catchStart >= 0 ? rec.slice(catchStart, catchStart + 600) : "";
    check(
      "an unreachable gate does not mute the assistant",
      catchBody.includes("opts.onFinal(text)"),
      // Failing closed would leave voice permanently deaf; the echo risk is the
      // lesser problem and is documented at the call site.
      catchBody ? "falls back to delivering the transcript" : "no catch found",
    );
  }
}

// ------------------------------------------------------- playback is bracketed
{
  const vs = read("src/services/voiceSession.ts");
  check(
    "recognition closes before audio starts and reopens after it ends",
    vs.indexOf("voice_begin_playback") < vs.indexOf("await play(playbackId)") &&
      vs.includes("voice_end_playback"),
    "begin -> play -> end",
  );
  check(
    "a failed or cancelled playback still reopens the microphone",
    /finally\s*{[\s\S]{0,200}voice_end_playback/.test(vs),
    // Without the finally, one TTS error ends the conversation silently.
    "end_playback runs in finally",
  );
  check(
    "cancellation is distinguished from failure",
    vs.includes("isCancellation") && vs.includes('"cancelled"'),
    "outcome is reported honestly",
  );
  check(
    "echo cancellation is requested and its real state read back",
    vs.includes("ECHO_CONSTRAINTS") &&
      vs.includes("describeAudioProcessing") &&
      vs.includes('"unknown"'),
    // Requesting a constraint is not the same as getting it, and a platform
    // that reports nothing must not be claimed as working.
    "requested vs active are separate facts",
  );
}

// ------------------------------------------ no surface keeps a private flag
{
  const vs = read("src/services/voiceSession.ts");
  check(
    "the session state lives in Rust, not in a module variable",
    !/^let\s+(speaking|isSpeaking|listening)\b/m.test(vs) &&
      vs.includes('invoke<VoiceStatus>("voice_status")'),
    // sonare-overlay is a separate WebView2 heap: a module-level flag here
    // would be two flags, and the overlay would transcribe the main window.
    "one authoritative owner",
  );

  const overlay = read("src/features/top-overlay/overlayActions.ts");
  check(
    "the overlay speaks through the shared session too",
    overlay.includes("speakWithTurnTaking"),
    "overlay playback is bracketed",
  );

  const rust = read("src-tauri/src/voice_session.rs");
  check(
    "only speaking and cooldown close the microphone",
    rust.includes("Self::Speaking | Self::Cooldown"),
    "everything else is the user's turn",
  );
  check(
    "the echo tail after playback is covered by a cooldown",
    rust.includes("DEFAULT_COOLDOWN_MS") && rust.includes("VoiceSessionState::Cooldown"),
    "playback end starts a cooldown",
  );
  {
    // Inside consider_transcript specifically — comparing positions across the
    // whole file just measures where the constants were declared.
    const fnStart = rust.indexOf("pub fn consider_transcript");
    const body = rust.slice(fnStart, rust.indexOf("pub fn reset", fnStart));
    check(
      "transcript similarity is a backup, not the primary defence",
      // Ambient speech can legitimately repeat what ArcSonare said, so this
      // must never be the only thing standing between the app and a loop.
      body.indexOf("VoiceSessionState::Speaking =>") <
        body.indexOf("SELF_SPEECH_SIMILARITY") &&
        body.includes("RejectedSpeaking"),
      "state is checked before similarity, inside the gate",
    );
  }
  check(
    "a repeated transcript cannot make two requests",
    rust.includes("DuplicateSuppressed"),
    "duplicate finals collapse to one",
  );
}

// ------------------------------------------------ realtime capture asks for AEC
{
  const realtime = read("src/services/realtime/RealtimeSession.ts");
  check(
    "the realtime microphone requests echo cancellation",
    realtime.includes("ECHO_CONSTRAINTS"),
    "constraints applied to getUserMedia",
  );
  check(
    "and logs what the track actually settled on",
    realtime.includes("describeAudioProcessing"),
    "active settings observed, not assumed",
  );
}

console.log(failed === 0 ? "\nAll voice turn-taking checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
