# Build Identity, Visual Trace and Voice Turn-Taking

**Date:** 2026-07-31
**Branch:** `master` · **HEAD:** `a8c17873d68b7b87d4a31a75274ed07759a36641`
**Scope:** why "Show me the Book folder on my Desktop" drew a border in the wrong
place, and stopping ArcSonare answering its own speech.

---

## 1. The headline: the test ran against a binary from before the fix

| | |
| --- | --- |
| Process tested | PID **21568**, started 5:55:50 PM |
| Its executable | `C:\Users\rober\AppData\Local\ArcSonare\ArcSonare.exe` |
| **That file was built** | **12:39:12 PM** |
| Dev build present at `target\debug\arcsonare.exe` | 5:38:29 PM |
| Release build present at `target\release\arcsonare.exe` | 5:55:19 PM |

The installed binary predates the entire visual ownership migration. It still
contains `capture_origin()` (dimension-matching against the monitor list) and
the monitor-under-mouse fallback. **A border in the wrong place is exactly what
that code does.** ArcSonare is single-instance, so `npm run tauri dev` hands off
to whatever is already running and exits — which is how a build can succeed
while the window on screen is hours old.

That does **not** prove the current code is right. It proves the test did not
exercise it. Two genuine defects were then found in the current code as well.

## 2. Two real defects in current code

**a) A desktop request was screenshotting an application.**
`executeScreenClickTarget` chose an `appHint` from `getLastFocusedApp()` or the
watched app and captured *that window*. For "Show me the Book folder on my
Desktop" it would photograph whatever was focused last and hunt for a desktop
icon inside it — find nothing that matches, settle on something else, and draw a
border round it. Fixed: when the request names the desktop, no app hint can be
right, so the whole display is captured
(`mentionsDesktop` in `frontendExecutors.ts`).

**b) There was no way to tell which stage failed.**
Wrong screenshot, wrong object recognised, geometry parsed wrongly, and mapping
error all look identical from outside. Added a per-correlation trace.

---

## 3. Status

| Item | Status |
| --- | --- |
| Running build identity verification | COMPLETE |
| Old-process shutdown verification | COMPLETE |
| Planner Book-folder request trace | PARTIAL |
| Correct display selection | PARTIAL |
| Actual screenshot inspection | NOT STARTED |
| Raw model target inspection | PARTIAL |
| Parsed target inspection | PARTIAL |
| Canonical rectangle inspection | PARTIAL |
| Recognition/mapping failure classification | PARTIAL |
| Structured Desktop icon lookup | NOT STARTED |
| UI Automation Desktop lookup | NOT STARTED |
| Vision fallback targeting | COMPLETE (unchanged) |
| Coarse-to-fine targeting | NOT STARTED |
| Exact folder-name matching | NOT STARTED |
| Ambiguous target handling | NOT STARTED |
| Planner physical highlight test | NOT STARTED |
| Overlay-target overlap verification | NOT STARTED |
| Voice session state machine | COMPLETE |
| Rust/shared voice state | COMPLETE |
| Half-duplex recognition suppression | COMPLETE |
| Playback-completion handling | COMPLETE |
| Cooldown handling | COMPLETE |
| Echo-cancellation request | COMPLETE |
| Echo-cancellation active-state verification | PARTIAL |
| Self-transcript suppression | COMPLETE |
| Duplicate-transcript suppression | COMPLETE |
| Overlay/main voice-state sharing | COMPLETE |
| User barge-in | NOT STARTED |
| Voice diagnostics | PARTIAL |
| Automated voice-loop tests | COMPLETE |
| Physical speaker/microphone test | NOT STARTED |
| Existing visual reliability regression | COMPLETE |
| DPI awareness | NOT STARTED |
| Display Mapping wizard | NOT STARTED |

---

## 4. Detail for COMPLETE items

### Running build identity · old-process shutdown
- **Files:** `src-tauri/src/build_info.rs` (`BuildInfo`, `current`, `summary`,
  `get_build_info`), `src-tauri/build.rs` (`stamp_build_identity`).
- Reports version, profile (debug/release), executable path, **executable
  modification time**, pid, process start time, git sha and build time. The
  modification time is the field that catches a stale process, because it needs
  no embedded metadata to compare against the last build.
- **Tests:** `the_running_binary_can_name_itself`,
  `the_executable_timestamp_is_readable`, `the_summary_names_the_path_and_the_pid`
- **Action taken:** stale PID 21568 (`AppData\Local\ArcSonare\ArcSonare.exe`,
  built 12:39) was terminated after verifying its path; `Get-Process arcsonare`
  then reported **no ArcSonare process remains**, and `npm run tauri dev` was
  started against the current tree.
- **Command:** `cargo test --lib` → **208 passed, 0 failed**

### Voice session state machine · shared state · half-duplex · cooldown
- **File:** `src-tauri/src/voice_session.rs` → `VoiceSession`,
  `VoiceSessionState`, `TranscriptDisposition`, `consider_transcript`,
  `begin_playback`, `end_playback`; commands `voice_status`,
  `voice_consider_transcript`, `voice_begin_playback`, `voice_end_playback`,
  `voice_set_cooldown_ms`, `voice_set_state`, `voice_reset`.
- **The state is in Rust deliberately.** `sonare-overlay` is a separate WebView2
  heap, so a TypeScript `speaking` flag would be two independent flags and the
  overlay's recogniser would transcribe what the main window is saying. One
  owner in the shared process is the only arrangement that cannot drift.
- Only `Speaking` and `Cooldown` close the microphone; every other state is the
  user's turn. Cooldown is evaluated lazily against the clock rather than by a
  timer, so it cannot fire after the state has moved on.
- **Tests (13):** `a_transcript_arriving_while_arcsonare_talks_is_not_a_user_request`,
  `the_echo_tail_right_after_playback_is_also_rejected`,
  `listening_resumes_once_the_cooldown_elapses`,
  `a_late_echo_of_what_was_just_said_is_still_caught`,
  `a_partial_mishearing_of_arcsonares_own_speech_is_caught`,
  `genuinely_different_speech_after_playback_is_accepted`,
  `the_same_transcript_twice_makes_one_request`,
  `failed_playback_still_reopens_the_microphone`,
  `cancelled_playback_still_serves_its_cooldown`,
  `an_empty_transcript_is_not_a_request`,
  `normalisation_makes_heard_and_spoken_comparable`,
  `only_speaking_and_cooldown_close_the_microphone`,
  `the_state_is_shared_rather_than_per_surface`

### Playback-completion handling
- **File:** `src/services/voiceSession.ts` → `speakWithTurnTaking`
- Recognition closes **before** audio starts and reopens only after playback
  genuinely ends, in a `finally` — a TTS failure that left the session in
  `speaking` would shut the microphone for the rest of the conversation.
  Cancellation and failure are reported distinctly, and a cancelled utterance
  still serves its cooldown because part of it was already heard.
- Wired at `overlayActions.ts::speakOverlayReply`.

### Self-transcript and duplicate suppression
- Every final transcript passes `considerTranscript` in
  `SpeechRecognitionService.ts` before it can become a request; rejected ones go
  to `onSuppressed` so a caller can say *why* nothing happened.
- Similarity matching is explicitly the **backup**, checked after the state — a
  test asserts that ordering inside `consider_transcript`, because ambient
  speech can legitimately repeat what ArcSonare said and must not be swallowed.
- **Command:** `npm run test:voice` → **15/15**

### Echo-cancellation request
- **File:** `voiceSession.ts` → `ECHO_CONSTRAINTS`, `describeAudioProcessing`;
  applied in `RealtimeSession.ts`.
- `describeAudioProcessing` reports `requested` and `active` separately and
  returns `"unknown"` when the platform does not report the field — a missing
  value is not the same as off and is never claimed as on.

### Existing visual reliability regression
- `npm run test:planner` 13/13, `test:ownership` 25/25, `test:files` 21/21,
  `test:pointer` 12/12, `test:vision` 7/7, `test:visual-dispatch` 24/24.

---

## 5. Verification commands and their real results

| Command | Result |
| --- | --- |
| `cargo test --lib` | **208 passed, 0 failed, 3 ignored** (was 192) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run test:voice` | **15/15** (new) |
| `npm run test:visual-dispatch` | 24/24 |
| `npm run test:planner` | 13/13 |
| `npm run test:ownership` | 25/25 |
| `npm run test:files` | 21/21 |
| `npm run test:pointer` | 12/12 |
| `npm run test:vision` | 7/7 |
| `rustfmt --check` on the changed Rust files | clean |
| `cargo clippy` | **NOT RUN** — not installed for the `stable-x86_64-pc-windows-msvc` toolchain |

Two of my own assertions failed first and were wrong, not the code: one measured
"somewhere later in the file" instead of the catch block, the other compared
constant *declaration* order instead of order inside the gate. Both were
rewritten to measure the real property.

---

## 6. What is NOT done, and why

**The Book-folder targeting bug is not proven fixed.** The stale build is
terminated, the app-hint defect is fixed and a trace exists — but the exact
command has not been re-run against the current build, so the actual screenshot,
raw model box and resolved rectangle have not been inspected. **The failure has
not been classified.** Until it is, treat the visual feature as unverified.

**Structured Desktop icon lookup (`desktop.find_item`) — NOT STARTED.** This is
the right answer for "show me the Book folder": the Windows shell knows exactly
where the icon is, so no model call is needed and nothing can be misrecognised.
It needs either cross-process `LVM_GETITEMRECT` against the desktop
`SysListView32` (which requires allocating memory inside explorer.exe) or a UI
Automation COM binding. Both are substantial FFI and neither should be
half-built.

**Coarse-to-fine targeting, exact name matching, ambiguous-target handling,
planner physical highlight test, overlay-overlap measurement — NOT STARTED.**

**Physical speaker/microphone test — NOT STARTED.** The state machine is proven
in unit tests including a partial mishearing, but no audio has actually been
played through the speakers and picked up by the microphone. The claim "voice
echo is fixed" is not yet earned.

**User barge-in — NOT STARTED**, deliberately: half-duplex has to be stable
first, and the setting should default off until the audio stack is shown to
distinguish speaker echo from a real interruption.

**Voice diagnostics — PARTIAL.** `voice_status` exposes state, cooldown,
playback and both suppression counters; there is no diagnostics view rendering
them.

**Echo-cancellation active-state verification — PARTIAL.** The read-back exists
and is logged; nobody has yet observed what WebView2 actually reports.

**DPI awareness / Display Mapping wizard — NOT STARTED**, as instructed.

---

## 7. The next session should start here

1. Confirm `get_build_info` reports the **debug** profile and a fresh
   executable timestamp before testing anything visual.
2. Run "Show me the Book folder on my Desktop" and read the trace: `capture`
   (which display, whole display or an app window), `model-raw` (box + label),
   `model-parsed`, `resolved`.
3. Classify from that: recognition, parsing, mapping or overlay.
4. If recognition — build `desktop.find_item` and stop using vision for named
   desktop items entirely.
