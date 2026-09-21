# Capability platform stabilization

Branch `master`. Nothing committed.

---

## 1. Tool-message protocol — COMPLETE

### The reported failure

> List all the connected apps.
> → *An assistant message with `tool_calls` must be followed by tool messages responding to each `tool_call_id`.*

Three independent defects produced it. All three are fixed by routing every
protocol append through one assembler.

**Defect 1 — a `user` turn between two tool results.** The final-response
contract added in the previous round was pushed inside the per-call loop, so a
two-call turn became:

```
assistant[A,B] → tool(A) → user(contract) → tool(B)      ← rejected
```

"List all the connected apps" is exactly the multi-call shape that triggers it.
This was a regression introduced by the response-contract work.

**Defect 2 — a confirmation pause abandoned the remaining calls.** `if
(outcome.pause) return` left calls B..N with no results at all. The history was
then malformed for the rest of the conversation, not just that turn.

**Defect 3 — the resume invented a `tool_call_id`.** It appended
`toolCallId: "confirmed"`, matching no declared call, while the real call stayed
unanswered — two violations in one message.

### The assembler

`features/capabilities/toolTurn.ts` owns the invariant:

```
assistant(tool_calls: [A, B]) → tool(A) → tool(B) → assistant(final)
```

- `ToolTurn.begin` declares the calls; from there the turn is a debt.
- `settle` records a real result; `leaveUnsettled` records why there is none.
- `close` appends exactly one result per declared call, in declaration order,
  synthesizing an honest `not-executed` / `awaiting-user-confirmation` payload
  for anything unsettled. Idempotent, so a resumed path cannot double-write.
- A tool that fails, is refused, times out, is cancelled, or is never reached
  still produces a result message. Omission is not an option the protocol allows.

Contracts are queued and appended only after `close()`.

**A bug the suite caught in the assembler itself:** the engine marks the paused
call and then sweeps the rest, and `leaveUnsettled` overwrote the specific
reason with the generic one. First reason now wins.

### Validation and repair

`validateTurns` runs before **every** provider request, catching missing
results, wrong order, orphan tool messages, duplicate ids, and non-tool roles in
the result window. `repairTurns` fills missing results with honest placeholders
and drops orphans.

Repair, not rescue: an assistant turn whose results cannot be reconstructed is
dropped rather than guessed at. Losing a turn of context is recoverable;
inventing tool results the tools never produced is worse than either.

`npm run test:tool-protocol` — 24 assertions covering both-succeed,
mixed-failure, both-fail, refused, timed-out, cancelled, not-executed, the
pause path, the invented id, duplicate ids, repeated closes, truncated stored
history, orphans, and untouched-when-valid. Plus source checks that the engine
actually routes through it.

## 2. Connected-app listing — PARTIAL

`connections.list` reads the connection registry, never the Discover catalogue.
Retrieval ranks it first (29) for "List all the connected apps."

`connectionStatus.ts` now separates two things that were conflated:

- `INTEGRATION_CAPABILITIES` — Discover card copy, describing what the *service*
  offers;
- `REAL_CAPABILITIES` — what *ArcSonare has built*, per connector.

Reporting the first as available is how a catalogue entry gets mistaken for a
working connector. A connector with a saved credential but no tools is reported
as "credential saved, but no tools are built for it yet" — connected, honestly
unusable.

Implemented today: YouTube (public read-only), Gmail, Google Calendar, Google
Drive. Everything else in Discover is a card.

**Not physically verified.**

## 3. Provider credential resolution — audited, NOT UNIFIED

The evaluation harness needs `DEEPSEEK_API_KEY` in the process environment
because it deliberately does not read the app's credential store — a test
process that can open Credential Manager is a test process that can leak from
it. The app itself reads the key in Rust (`credentials::get_provider_key`) and
never exposes it to frontend JavaScript, which is the correct design.

The requested unification — a Rust-owned command that runs an evaluation
internally and returns results rather than the key — is **not built**. The
current workaround reads the value from `HKCU\Environment` for a single
invocation and never prints it.

No `VITE_`-compiled provider key was found; the key is Rust-owned.

## 4. Not done

| Item | Status |
| --- | --- |
| Full connector inventory (14 connectors) | NOT STARTED |
| Honest Connect UI states | NOT STARTED |
| Single registry shared by chat + voice | NOT STARTED |
| Chat/voice parity tests | NOT STARTED |
| 100-scenario headless matrix | NOT STARTED — 40 exist |
| Physical smoke tests | NOT STARTED |
| Rust-owned evaluation broker | NOT STARTED |

## 5. Model evaluation — unchanged at 95%

40 scenarios, `deepseek-v4-flash`. Confirmation resolution 100%, tool selection
95%, all five safety invariants clean.

The one failure is a provider serialisation quirk: on "What did MrBeast upload
recently?" the model selects `youtube.search` correctly but emits it as *text*
markup instead of a `tool_calls` field. The tag varies between runs
(`<｜｜DSML｜｜tool_calls>`, then `<user_tool_call>`), confirming it is not a
fixed string. The user-visible symptom is stripped; the turn still does nothing.

---

# Part 2 — connector inventory and the canonical registry

## The inventory, derived from code

Discover shows **42 connectors. Five have working tools.**

| Status | Count | Connectors |
| --- | --- | --- |
| **COMPLETE** | 3 | Gmail (8 caps), Google Calendar (5), Google Docs (3) |
| **PARTIAL** | 2 | YouTube (3, public read-only), Google Drive (2, read-only) |
| **AUTH_ONLY** | 21 | Slack, Notion, GitHub, Discord, Telegram, WhatsApp, Spotify, Bitbucket, Home Assistant, X, MySQL, PostgreSQL, Redis, SMTP, TMDB, OpenWeather, Zillow, SSH, Twilio, Unsplash, ElevenLabs |
| **UI_ONLY** | 16 | Outlook, Teams, OneDrive, Dropbox, Linear, Zoom, Trello, Figma, ClickUp, Todoist, Google Meet, Google Sheets, Evernote, OneNote, Loom, Higgsfield |

**AUTH_ONLY is the category that did not previously exist and matters most.**
Twenty-one connectors present a credential form, accept a real secret, store it
in Windows Credential Manager — and have nothing behind it. That is worse than
an honest "coming soon", because filling the form looks like success.

VS Code is not an integration at all; it is a desktop-app icon used by Running
Apps. It was never a connector.

## The registry is derived, not asserted

`features/capabilities/connectorRegistry.ts` computes a connector's capabilities
**from the capability registry itself**. The only hand-maintained fact is which
id prefixes belong to which connector — five entries.

This is the property that matters: add a `slack.*` capability and Slack stops
reporting AUTH_ONLY on the next render, with no list to remember to update. A
hard-coded inventory would be correct today and wrong at the first change, which
is exactly how the previous mismatch arose.

Statuses and states both fall out of it:

- `connectorImplementation` — COMPLETE / PARTIAL / AUTH_ONLY / UI_ONLY
- `connectorState` — CONNECTED_VERIFIED / CONNECTED_LIMITED /
  CONFIGURED_UNVERIFIED / ERROR / DISCONNECTED / COMING_SOON / UI_ONLY
- `capabilityAllowedForOrigin` — the single gate chat and voice both consult

`connections.list` and `connectionStatus` now read from it, replacing the
hand-written capability list from the previous round.

## COMPLETE — physically verified

> **List all the connected apps.**
> You've got two apps connected, Robera: YouTube (full read-only access —
> search, channel feeds, opening results) and Discord, where your credential is
> saved but no tools are built yet.

No protocol error. Only genuinely connected connectors listed. Discord —
AUTH_ONLY — correctly described as a stored credential with nothing behind it.
No Discover cards claimed as connected. No internal ids.

> **What can YouTube do?**
> Search YouTube · List a channel's newest uploads · Open and control a video.
> Outside that: the connection is read-only, so no likes, comments,
> subscriptions, or uploads.

Matches the registry exactly, including the unavailable list.

**One inaccuracy:** the model said YouTube has "full read-only access" where the
registry says "Public read-only". "Full" overstates it — the connection cannot
read the user's own data at all. The fact-check gate does not catch this because
it is an embellishment, not a success/failure contradiction.

## Test coverage

`npm run test:connector-registry` — 60 assertions. Derived rather than pinned:
every Discover card classified, status following from what exists, UI-only cards
never connectable and never reaching a connected state, auth-only connectors
never reported as connected, origin filtering as one shared gate, every
chat/voice difference declared on the capability, and no orphan connector
capabilities.

## NOT STARTED

| Item | Why |
| --- | --- |
| Connect UI rendering the new states | Registry exists; the page does not consume it yet |
| Voice consuming the shared gate | `capabilityAllowedForOrigin` exists; the voice path does not call it |
| Rust-owned evaluation broker | Unbuilt; harness still needs the env var |
| 100-scenario matrix | 40 exist |
| Remaining physical smoke tests (voice, Gmail) | Not run |

---

# Part 3 — deterministic wording, honest Connect UI, shared origin gate

## COMPLETE — deterministic connector wording

`features/capabilities/connectorClaims.ts`. The observed failure was one word:
the registry says YouTube is **public read-only**, the assistant said **full
read-only**. That inverts the meaning — "public" says it cannot see your data,
"full" says it can see all of it — and the fact-check gate misses it because it
is a scope claim, not a success/failure contradiction.

- Absolute qualifiers (`full`, `fully`, `complete`, `entire`, `all its
  features`) are **rewritten** to the registry's own qualifier rather than
  rejected, so the sentence stays natural.
- A claim of account-scoped reach on a public-only connector ("your
  subscriptions") cannot be repaired and is **rejected**, falling back to the
  deterministic text.

Physically verified:

> **List all the connected apps.**
> You have 2 connected apps, Robera: YouTube is connected with **public
> read-only** access (search, channel updates, opening results), and Discord is
> connected with the credential saved — though its tools aren't built yet, so
> it's marked as "coming soon."

Both connectors described exactly as the registry defines them.

## COMPLETE — honest Connect UI

`ConnectGrid` now consumes `connectorRegistry`:

| Implementation | Card action | Status line |
| --- | --- | --- |
| COMPLETE / PARTIAL | Connect / Manage | access level, e.g. "Account read + send" |
| AUTH_ONLY | "Set up credential", dashed and dimmed | "Authentication only · tools not implemented yet" |
| UI_ONLY | **no action at all** — a "Coming soon" chip | none |

Physically verified on the Connect page: OneDrive and Linear show *Coming soon*
with no `+` button; Slack and PostgreSQL show *Authentication only · tools not
implemented yet*; Gmail shows *Account read + send*; Google Drive shows
*Account read-only*.

A UI-only card can no longer open a credential form.

## COMPLETE — one origin gate for chat and voice

`capabilitiesForOrigin(origin, connectedConnectors)` is now the only filter.

Voice previously used its own inline predicate (`availability === "available" &&
supportsVoice`) that **ignored connector state entirely** — which is why it
advertised Gmail tools with Gmail disconnected and then had to deny a tool it
had just offered. Both surfaces now narrow identically:

```
gmail tools offered with nothing connected: 0
youtube tools with nothing connected:       0
youtube tools with youtube connected:       3
connection-status tools always available:   3
```

Connection-status capabilities deliberately survive a missing connector —
otherwise "is Gmail connected?" is unanswerable exactly when the answer is no.
`explainUnavailable()` supplies the honest refusal ("gmail is not connected yet,
so that isn't available") instead of "there is no such tool".

## COMPLETE — restart smoke test

Zero processes → rebuild → PID 43744 at
`src-tauri/target/debug/arcsonare.exe`, zero LocalCache processes, Connect page
honest, `connections.list` clean, no credential exposure.

## NOT STARTED

| Item | Status |
| --- | --- |
| Rust-owned evaluation broker | NOT STARTED |
| 100-scenario suite | 40 exist |
| Voice physical parity tests | NOT STARTED |
| Connector detail panel (per-card capability lists) | NOT STARTED |
| Explicit origin fields (background automation, direct UI) | NOT STARTED — chat/voice only |

---

# Part 4 — broker, matrix, origin policy, detail panel

## COMPLETE — Rust-owned evaluation broker

`src-tauri/src/eval_broker.rs`, compiled only under `#[cfg(debug_assertions)]`
so a release binary has no evaluation surface at all rather than a hidden one.

`eval_model_selection` resolves the provider credential through
`credentials::get_provider_key`, makes the request, and returns only:
selected capability, sanitized arguments, assistant text, HTTP status, an error
*category*, and timing. The key, the Authorization header and the raw provider
response never leave the function — not in the return value, not in an error,
not in a log. A network error yields `"timeout"` or `"network"` and nothing
from the underlying message, which can name the URL it tried.

`eval_provider_available` reports presence without revealing anything else.

`features/capabilities/evalRunner.ts` drives it from inside the app, building
tool schemas from the production registry and the shared origin gate, then
recording — never executing — what the model chose. Exposed as
`window.__arcsonareEval` in dev builds only.

**Honest limit:** the Node harness still needs `DEEPSEEK_API_KEY` because it
runs outside the app and cannot reach Tauri IPC. The in-app runner is the path
that needs no second copy of the credential.

## COMPLETE — 107-scenario platform matrix

`npm run test:platform-matrix`. All absolute thresholds at 100%:

| Threshold | Result |
| --- | --- |
| valid tool protocol | 100% (15 scenarios) |
| connector state truth | 100% (7) |
| origin policy | 100% (13) |
| chat/voice consistency | 100% (12) |
| wording cannot be embellished | 100% (8) |
| conversation follow-ups | 100% (11) |
| implemented-connector truth | 100% (16) |
| no side effects | 100% (2) |
| retrieval routing | 100% (9) |
| google connector gating | 100% (10) |
| account/conversation isolation | 100% (4) |

Two defects it found:

- **`"google"` was a `web.search` alias**, so "is google drive connected?" scored
  the browser search above `drive.get_connection_status`. The alias is now the
  verb phrase ("google it"), and the Google connectors' status tools carry the
  words people actually use.
- **The suite's own safety check matched its own assertion text** — grepping for
  `frontendExecutors` anywhere hit the string in the check. It now matches an
  actual import statement.

## COMPLETE — four-origin policy

`originPolicy(capability, origin)` for chat / voice / direct-ui / background,
derived from risk and reversibility rather than four new booleans on 97
definitions — a policy computed from risk stays correct when a capability's risk
changes, whereas hand-set flags quietly do not.

- **voice** refuses destructive actions outright: speech cannot show what is
  about to happen before it happens.
- **background** allows read-only capabilities and nothing else.
- **direct-ui** is widest — the user clicked a control that names the action —
  but still confirms destructive steps.

## COMPLETE — connector detail panel

Selecting a card shows status, access level, authentication type, chat tool
count, voice tool count, available operations and unavailable operations
(struck through). Capability **names** only; internal ids stay in developer
diagnostics.

## COMPLETE — real-model threshold

40 scenarios against `deepseek-v4-flash`, all evaluated, none skipped:
confirmation resolution **100%**, tool selection **95%** (threshold 90%). All
five safety invariants clean.

The single failure was the provider serialising a tool call into `content`
instead of `tool_calls` — observed with three different tag shapes for the same
prompt (`<｜｜DSML｜｜tool_calls>`, `<user_tool_call>`, `<user.youtube.search>`).
The model chose correctly every time. `recoverTextEmbeddedCall` now converts
such a message back into a real tool call, but **only** for a capability that
was actually offered for that request — without that constraint it would be a
path for arbitrary text to become a tool call.

## Note

`src/pages/TasksPage.tsx` had a pre-existing lucide type error (its
`ForwardRefExoticComponent` is not assignable to a plain `ComponentType`),
unrelated to this work but blocking `tsc`. Widened by one line to unblock the
build.

---

# Part 5 — final state

## COMPLETE — 125-scenario platform matrix, all thresholds 100%

`npm run test:platform-matrix`. Three defects it found after Part 4:

1. **Two gates, disagreeing.** `capabilityAllowedForOrigin` checked only
   `supportsVoice`; `originPolicy` also refused destructive actions by voice.
   The voice tool list therefore still contained `filesystem.delete` and
   `tasks.delete` — a second allowlist drifting from the first, which is the
   exact failure the shared gate was built to end. The first now delegates to
   the second, so there is one gate.
2. **`connections.get_status` still returned Discover marketing copy.**
   `listConnectedApps` had been fixed; the single-service read had not. Asking
   "is Discord connected?" could therefore imply a feature list that does not
   exist. It now returns the connector registry's real capabilities, and the
   summary states implementation status.
3. **Chat/voice divergence assertion encoded the old model.** It required
   `supportsVoice === false`; divergence can now also be policy-based. It now
   requires a *stated reason* for every difference, which is the actual
   requirement.

## COMPLETE — voice parity through the production builder

The matrix calls `buildRealtimeTools` — the function the Realtime session
actually invokes — and asserts it agrees with the shared gate under three
connector states, that every offered tool exists, that no disconnected
connector's tools leak, and that voice never receives a destructive capability.
That is stronger than a screenshot: it exercises the path rather than observing
one instance of it.

## COMPLETE — provider serialisation recovery

`recoverTextEmbeddedCall` converts a tool call the provider wrote into `content`
back into a real call, for the three observed tag shapes, keeping the arguments.
Constrained to capabilities actually offered for that request — without that,
arbitrary text could become a tool call. Ordinary prose and unoffered
capabilities are never recovered.

## COMPLETE — physical verification

> **Is Discord connected?**
> Discord is connected, Robera — your credential is saved. Just note there
> aren't any Discord tools in ArcSonare yet, so there's nothing I can do with it
> for now.

The honest AUTH_ONLY answer, from the registry.

Restart regression: 0 processes → rebuild → PID 44848 at
`src-tauri/target/debug/arcsonare.exe`, build 01:23, git HEAD `a8c1787`, one
process, no stale LocalCache instance, broker commands present in the binary.

## Real-model evaluation

40 scenarios, `deepseek-v4-flash`, none skipped. Confirmation **100%**, tool
selection **95%** (threshold 90%). All five safety invariants clean.

---

# Closure pass

## COMPLETE — the Node harness no longer needs a key

`src-tauri/src/bin/eval_selection.rs` is a debug-only binary that resolves the
provider credential from Windows Credential Manager — the same resolver the app
uses — makes the request, and prints one line of sanitized JSON. Node runs it as
a subprocess. No environment variable, no local HTTP server, no second copy of
the key anywhere on the machine.

What it may print is a closed set (`Output`): prompt, origin, candidates,
selected capability, arguments, validation, recorded execution, protocol status,
side-effect count, duration, error *kind*. The credential, the Authorization
header and the provider's raw body are not in it. Failures are reported as a
category — `unauthorized`, `rate-limited`, `provider-error`, `timeout` — because
a provider's error text can quote the request that produced it.

Verified with `DEEPSEEK_API_KEY` unset: 40 scenarios ran, confirmation 100%,
tool selection 95%. A secret scan over the full stdout and stderr found nothing,
including on three deliberate error paths (bad model, malformed tools JSON, no
arguments).

`default-run = "arcsonare"` in `src-tauri/Cargo.toml` — adding a second binary
made `cargo run` ambiguous, and `tauri dev` issues a bare `cargo run`. Without
it the app does not start at all. Caught by the restart regression below, which
is the reason it exists.

## COMPLETE — voice, through the production path

`scripts/check-voice-parity.mts` (`npm run test:voice-parity`) drives controlled
transcripts through the real modules: `buildRealtimeTools` for what voice is
offered, `retrieveCapabilities(origin: "voice")` for what a transcript reaches,
`dispatchRealtimeToolCall` for what actually runs, `sessionGuard` for whether it
may. Speech is the only substitution.

The eight transcripts, and what each proves:

| Transcript | Result |
| --- | --- |
| Check if YouTube is connected | reaches `connections.get_status` |
| List my connected services | reaches `connections.list` |
| What can YouTube do? | reaches `connections.get_status` (see below) |
| What Gmail tools are available? | no Gmail tool offered; "gmail is not connected yet, so that isn't available" |
| What can Discord do? | AUTH_ONLY — credential saved, no tools, none offered |
| Send a hello message in Discord | no Discord capability, and nothing that sends anywhere |
| Open my Dropbox files | UI_ONLY — not usable, not connectable, nothing offered |
| Delete the books folder / that task | nothing destructive surfaces; reason stated; chat keeps it |

Dispatched for real: `connections.list` and `connections.get_status` both return
results rather than protocol errors, the spoken summary contains no capability
id, a `filesystem.delete` call invented by the model is not executed, and
`"unknown tool"` is reserved for names that are genuinely not capabilities —
which was the original defect, voice answering "there is no such tool" for a
real tool whose connector was disconnected.

Two real defects fell out of writing it:

**"What can YouTube do?" retrieved a search.** Intent examples score on token
overlap with a two-token minimum, but that question reduces to `["youtube"]`
after stopwords — no example could ever reach two, so the capability-inventory
tool never entered the candidate list and the model chose between searching
YouTube and listing a channel. `retrieveCapabilities` now requires one overlap
when the request has only one content token. `connections.get_status` went from
absent to second place; all thirteen existing suites still pass.

**`connectorProfile.available` means "built", not "reachable".** The first
version of the test read it as reachability and failed. It is the right split —
"Gmail has 8 tools" and "Gmail is not connected" are two facts, and collapsing
them is what turns an answer into a denial — but the test now says so
explicitly, including that `email.get_connection_status` is deliberately exempt
from connector gating, because "is Gmail connected?" has to work precisely when
it is not.

Node cannot normally import the engine — `import.meta.glob` is Vite syntax and
throws. `scripts/register-renderer-stub.mjs` supplies the minimum renderer
surface and a Tauri `invoke` that **rejects**, so nothing can reach the machine
and a capability that tries fails visibly instead of looking successful. It is
separate from `register-asset-stub.mjs` on purpose: the pure suites must keep
failing loudly if they ever reach for `window`.

## COMPLETE — the TasksPage type

`icon: ComponentType<{ size?: number | string }>` is the accurate type, not a
widening to silence the compiler. These are lucide icons and `LucideProps`
declares `size?: number | string`. The narrower `{ size?: number }` used in four
other files is correct *there*, for the hand-written components in `Icons.tsx`,
and cannot accept a lucide icon: React's `FunctionComponent` carries
`propTypes?: WeakValidationMap<P>`, which is invariant in `P`. The alternative
was a cast, which hides a real mismatch. Documented at the declaration; the only
call site passes `size={15}`. No `any`, no unsafe union.

## Restart regression

Steps completed:

| # | Step | Result |
| --- | --- | --- |
| 1–2 | Stop all processes, confirm zero | 0 `arcsonare.exe`; the four `node.exe` are pm2, Adobe, and two unrelated projects |
| 3 | Check debug / installed / LocalCache paths | debug 08-02 01:23 · release 07-31 · `%LOCALAPPDATA%\ArcSonare` 07-31 (stale, not launched) · no Program Files install |
| 4 | Launch latest debug build | `npx tauri dev` |
| 5 | PID / path / build time / HEAD | 7892 · `src-tauri\target\debug\arcsonare.exe` · 08-02 01:23:49 · `a8c1787` |
| 6 | Confirm one process | exactly 1 |
| 7 | No stale overlay | none on screen |
| 8 | Both display profiles Valid | `status: valid` for both, EDID-derived identities, mean error 3.2px and 1.5px |

| 9 | Books-folder highlight | tight purple frame around `books` alone; Gemini, ArcSonare_, SAM3, tropies_a all outside it |
| 10 | Temporary task created | "Restart regression probe 8021" — chat → SQLite row `task-msc8kmzc-e8m1u` |
| 11 | Durable persistence + Tasks page | row read straight out of the account database; Tasks page and Up Next both updated (8 → 9 open) |
| 12 | Four connector questions | verbatim answers below |
| 13 | Voice | controlled transcripts pass; the live Realtime session opened, listened, and closed with no action |
| 14 | No protocol errors | none; one transient `DeepSeek request failed: error sending request for url (linked-page)`, a network transport failure, reported honestly |
| 15 | No credential exposure | the failing URL was redacted to `(linked-page)`; a secret scan over 734 lines of app log found nothing |
| 16 | Quit completely | tray → Quit ArcSonare; 0 processes, dev server exited |
| 17 | Relaunch | PID 22100, same debug path, straight to Dashboard |
| 18 | Task and connector state persist | task present; "You've got 2 connected right now… YouTube is public usable… Discord is saved as a credential but still 'coming soon'" |
| 19 | Remove the temporary task | deleted through chat; `deleted_at` set, and the query the app runs returns 8 tasks without it |

The four connector questions, after the restart:

> **List all the connected apps** — "Right now you have two connected: YouTube
> (public, read-only — search, newest channel videos, and opening results) and
> Discord, which is saved but coming soon with no tools built yet."
>
> **Which integrations can I use?** — "Right now you've got two integrations,
> Robera: YouTube is public connected with public read-only access, and Discord
> is connected but still coming soon since no tools are built for it yet."
>
> **What Gmail tools are available?** — "Gmail isn't connected yet, so I don't
> have any email tools available at the moment — once it's linked, I can read
> and draft messages for you." *(with a Connect Email action)*
>
> **Which tools can I use through voice?** — "Through voice you get YouTube's
> three tools: searching YouTube, pulling the newest videos from a channel, and
> opening a search result. Discord is saved but not built out yet, so nothing
> voice-ready there for now."

Per-account isolation is visible on disk: one SQLite database per account hash
under `%APPDATA%\com.arcsonare.desktop\arcsonare\users\`, plus a separate
`guest`.

## FAILED — the task list does not drop a deleted task

Found by step 19. `tasks.delete` from chat writes correctly — `deleted_at` set,
absence verified, and the app's own `WHERE deleted_at IS NULL` query returns 8
tasks without it — but the Tasks page kept listing it, "Open tasks" kept reading
9, and Up Next kept showing it. Navigating away and back did not clear it.

Creation propagates; deletion does not. Both paths emit `TASKS_CHANGED_EVENT`
from Rust after commit (`src-tauri/src/database/tasks.rs:315` and `:367`), and
`deleteTaskDurable` also filters the in-memory array and calls `emit()`, so the
cause is not obvious from reading. It needs the app unlocked and instrumented.

Note that `scripts/check-task-durability.mts` passes while this is broken: it
asserts the database, which is correct. The regression test this needs asserts
the *observable list*.

## Microphone

Not blocked. Both halves of input were verified physically: the composer's
dictation captured room audio and transcribed it ("Hello, what can you do?")
without sending, and the Realtime overlay opened, showed a live waveform while
listening, and closed with no action taken. What this agent cannot do is
*produce* speech, so no full spoken tool turn was driven end to end — that part
is covered by controlled transcripts through the production modules.

---

# Completion pass

## COMPLETE — deleted tasks disappear everywhere

**Cause.** Hydration replaces the whole list with a database snapshot. Creates
were already protected against a snapshot older than the write
(`writesDuringHydration`); deletes had no mirror. A snapshot requested before
the soft-delete committed still contained the row, so when it landed it put the
task back. Every mutation emits `TASKS_CHANGED_EVENT` and every window
rehydrates on it, so the race was routine rather than rare — which is why the
task stayed visible in Tasks, Up Next and the galaxy while SQLite was correct.

**Fix.** Commit-timestamped tombstones in `src/stores/taskStore.ts`. A tombstone
is recorded when the delete is issued and stamped when the write returns; it is
only forgotten once a hydration was *started after the commit*, which is the
only point at which a snapshot is guaranteed to reflect it. Both delete paths
use it — `deleteTaskDurable` (the assistant) and `removeTask` (the Tasks page
button, which does not await its write and was even more exposed).

`hydrateTasksFromDb` also coalesces: a read requested while one is running sets
a flag and runs another pass rather than handing back the in-flight snapshot.
Without that, a `tasks-changed` event announcing another window's commit was
answered with a snapshot taken before it.

**Test.** `npm run test:task-delete-sync`, against a working fake backend
(`scripts/register-task-backend-stub.mjs`) that implements the four task
commands with the same `deleted_at IS NULL` semantics as
`src-tauri/src/database/tasks.rs` and emits the change event after commit. It
asserts the *observable* list, not the database — the pre-existing
`check-task-durability.mts` asserts the database and passed throughout the bug.
The in-flight-hydration case reproduced the failure before the fix.

Verified physically: after a full restart the previously-stuck task is absent
from the Tasks page, from Up Next, and from the open count (8, not 9).

## COMPLETE — repeated permission prompts: cause and grant

**Cause.** Approval was scoped to `ExactAction` — one capability, one argument
fingerprint, one run, consumed once. One spoken sentence becomes several tool
steps, each with its own run, so each asked its own question; and a step that
re-resolved its target changed the fingerprint, which read as `ActionChanged`
and asked again. There was no notion of a request, so nothing could remember
that the user had already approved the plan the step belonged to.

**Fix, part one — `src-tauri/src/capabilities/approval.rs`.** A request-level
`ApprovalGrant`, owned in Rust because the voice overlay and the main window are
separate WebView2 heaps and a TypeScript grant would be two grants that
disagree. A grant covers a request: same account, conversation, origin, risk at
or below what was approved, capability named by the plan, resource inside the
approved scope. It is reused, not consumed. It refuses to widen: destructive
steps and anything with an external recipient are rejected before the grant is
even looked up, a destructive approval cannot be granted up front at all, and a
blanket grant with no capability list is only accepted for read-only. Eleven
tests, including the reported four-step request producing one approval, and
scope matching by path segment so `Pictures2` is not inside `Pictures`.

**Fix, part two — `src/features/capabilities/permissionPolicy.ts`.** The other
half of the conflation: "is this dangerous?" and "have we asked already?" were
one flag. The policy answers only the first, per capability — `none`,
`per-request`, `always` — and `needsPrompt` combines it with the grant. Split
that way, `always` cannot be argued out of asking by any grant state and
`none` cannot be made cautious by a default.

**Test.** `npm run test:permission-policy` counts the prompts a request would
produce:

| Request | Prompts |
| --- | --- |
| five read-only inspection steps | 0 |
| open image → highlight person → circle face | 0 |
| every step re-run after a target refresh | 0 |
| inspect, highlight, then click | ≤ 1 |
| delete one task | exactly 1 |
| three deletes | exactly 3, and the plan describes them as one batch |
| approved highlight, then send a message | still asks |

Plus: every capability the registry calls destructive is `always`, every one it
calls read-only is `none`, and an unknown capability is `always` rather than
silently allowed.

## COMPLETE — debug-only automated unlock

`src-tauri/src/dev_unlock.rs`, behind `#![cfg(debug_assertions)]` — absent from
a release binary rather than disabled in one. The password comes from
`ARCSONARE_DEV_PASSWORD` or a gitignored `.dev-password` at the project root; it
is never a literal in source, never logged, never returned, and never in an
error. Failures are categories (`no-credential`, `wrong-password`, `bad-hash`)
because the underlying error can quote what it failed to parse.

It is not a bypass: the password is verified against the same Argon2 hash as
`unlockWithPassword`. The only thing automated is supplying the input.

`src-tauri/src/release_safety.rs` is compiled in both profiles and asserts the
gating structurally: the `mod` declaration and both command registrations are
each preceded by `#[cfg(debug_assertions)]`, the module carries its own inner
cfg, and `.dev-password` is gitignored. A test living inside the debug-only
module could not prove any of this, because it is not there either.

Verified physically: `tauri dev` now opens straight to the Dashboard.

## Remaining

Objectives 3–9 and 12–15 of the completion list are not done: the false
"screen moved" reporting, the annotation layer and its lifecycle, the semantic
application map, Spotify inspection and guidance mode, the controlled test
application, and the physical voice and final restart passes.

---

# Batch approval pass

## COMPLETE (physically verified) — three deletions, one prompt

`src/features/capabilities/deletionBatch.ts` groups the same always-confirm
capability on two or more distinct targets within one assistant turn into one
enumerated confirmation. `src-tauri/src/capabilities/approval_plan.rs` owns the
enforcement: an approved plan names each row by resource identity and canonical
arguments, and each row can be claimed exactly once. 14 Rust tests, including a
fourth task refused, arguments substituted, expired plan, replayed claim, and a
half-failed batch reported as two-of-three rather than done.

Physically, in the debug build:

> **Delete these three tasks: Gate probe one, Gate probe two, and Gate probe three**
>
> Hey Robera, these three are lined up for deletion:
> • Gate probe one
> • Gate probe two
> • Gate probe three
> Want me to go ahead?

One question, every row named, and the database still had all eleven tasks —
nothing ran.

## FAILED, then fixed — model-selected deletions had no confirmation at all

The first physical run deleted all three tasks **without asking anything**. Not
three prompts: zero.

`needsFrontendConfirmation` was only consulted in `runSingleCapability`, which
is the deterministic router. Every model-selected call — which is nearly all of
them — went through `executeModelToolCall` straight to `executeCapability`. So
"delete this task" typed into chat deleted it silently, and had done since the
model-tool-call path was introduced. The batching work is what surfaced it: the
test for "three prompts" found zero.

The gate now runs on that path too, before execution, and pauses the model loop
the same way the deterministic path does.

## FAILED — chat cannot resolve a confirmation conversationally

With the gate in place the batch correctly stops and asks. Answering "Yes, go
ahead" in chat then does nothing useful:

> Sure — go ahead with what? I don't have a pending request on my end.

`resolvePendingConfirmation` has exactly one caller,
`src/features/top-overlay/overlayActions.ts`. The voice overlay can approve a
pending confirmation; the main chat window has no path to it, so a typed "yes"
is routed as a fresh request and the pending run is left hanging.

The safety direction is right — the deletion is blocked rather than silently
executed, and the eleven tasks were still there afterwards — but the request
cannot be completed from chat. This is the next thing to fix, and it blocks the
"one approval covers the batch" end-to-end verification.

## COMPLETE — target outcomes are specific, and recover on their own

`src-tauri/src/display/target_recovery.rs` replaces one generic
`SCREEN_CHANGED_BEFORE_ACTION` with eight classified outcomes, three of which
proceed silently: `Fresh`, `Recovered` (the target was found again after
moving), and `IgnorableChange` (our own overlay or the mouse pointer was inside
the compared region). Re-resolution is attempted up to twice before the user is
asked, identity is compared rather than only pixels, and a topology change is
checked before similarity because coordinates from before it mean nothing.

The failure messages are now distinct sentences — "I can't see that on screen
any more", "I found more than one match", "The window that was in has closed",
"The display layout changed" — and a test asserts none of them falls back to
"the screen moved". 12 tests.

Wired into `pre_action_freshness`: an unavailable check and a changed region are
no longer the same sentence, and an overlay or cursor inside the region no
longer fails the action. That last case is why the *second* annotation of any
request used to fail — the first one's highlight was still on screen.

**Not yet physically verified**, and the automatic re-resolution callback is not
yet connected to a real re-resolver: `classify` takes one, and
`pre_action_freshness` currently uses the overlay/cursor exemptions and the
outcome vocabulary without attempting re-resolution.

## COMPLETE (physically verified) — a confirmation can be answered in chat

Two mechanisms had grown up beside each other without meeting. A
`PendingAction` is something the assistant *offered*, and `resolveFollowUp`
answers it. A pending confirmation is something the assistant is *blocked on*,
and `resolvePendingConfirmation` had exactly one caller — the voice overlay's
buttons. In chat the run stayed parked and the answer was routed as a new
request.

Underneath that was a smaller and more direct fault: `classifyConfirmation`
anchored each pattern to a single phrase, so **"Yes, go ahead" classified as
`none`**. Not "affirmation with nothing pending" — not an affirmation at all.
Every multi-word yes fell straight through to routing.

Both fixed:

- `confirmationIntent.ts` matches a *chain* of answer phrases — "yes, go
  ahead", "ok, do it", "yes please" — and nothing else. A chain must be answer
  phrases end to end, so "yes, delete the other one instead" is still `none`
  and gets routed as the new instruction it is. Any clause that declines makes
  the whole message a decline, because the safe reading of "no, go ahead" is
  the one that does nothing.
- `capabilityEngine.ts` records which run is parked, per conversation, at all
  six pause sites, and answers it ahead of offers and fresh routing. An answer
  is scoped to its conversation and to the origin that asked, expires after
  five minutes, and cannot outlive the run.

Physically, same sequence as the report:

> **Delete these three tasks: Gate probe one, Gate probe two, and Gate probe three**
>
> Happy to take care of that. Just to confirm before I delete them: Gate probe
> one, Gate probe two, and Gate probe three. Go ahead?
>
> **Yes, go ahead**
>
> All three Gate probe tasks are gone, Robera — the deletion went through and
> confirmed clean. Nothing left on that list.

Database afterwards: 8 live tasks, 3 `Gate probe%` rows soft-deleted, 0 still
live, and the other eight untouched. One question, one answer, three deletions,
nothing extra.

---

# Recovery and suite pass

## COMPLETE — replay protection, physically

After the batch ran, typing "Yes, go ahead" again produced *"That result isn't
current any more. Want me to look it up again first?"* and the open-task count
stayed at 8. The marker is taken when the answer is consumed, so the second
answer finds nothing to answer and nothing runs twice.

## COMPLETE — the real re-resolver

`src-tauri/src/display/target_search.rs`. `target_recovery::classify` took a
callback and production passed it nothing, so the classifier could only ever
conclude "gone" — a window nudged twenty pixels still failed the request. This
is the search: take the target's surroundings as they were when the model saw
them, slide that patch over a fresh capture of a ±120px window, and report where
it went.

The first attempt reused `freshness::similarity`, a mean absolute difference.
That is the right metric for "is roughly the same thing still here?" and the
wrong one for searching: a dark control on a dark desktop differs from blank
wallpaper by very little in absolute terms, so a marker scored above threshold
against empty background and every offset matched. Replaced with zero-mean
normalised cross-correlation, which compares structure rather than brightness.
Blank areas correlate with nothing and are therefore unmatchable, which is the
property that makes "not found" mean something.

A second near-tie only counts as ambiguity if it is at least half a patch away
from the best match — the first version compared against the second-best score
anywhere, which is always the neighbouring offset overlapping the same target,
so every single match read as ambiguous.

Wired into `pre_action_freshness`: a stale region is searched, up to
`MAX_AUTOMATIC_ATTEMPTS`, before any error is raised. A found target returns a
corrected region and the action continues with no message and no new permission.

## COMPLETE — the eleven change scenarios

`src-tauri/src/display/screen_change_test.rs` asserts each independently:

| Change | Outcome |
| --- | --- |
| cursor over the target | continue silently |
| our own border, then our own circle | continue silently |
| image finishes decoding | recovered, continue |
| window moves slightly / resizes | re-resolved, continue |
| unrelated pixels animate | region still fresh |
| target moves inside its window | identity kept, coordinates updated |
| target disappears | "I can't see the Next button on screen any more." |
| two similar targets | "I found more than one match. Which one do you mean?" |
| source window closes | "The window that was in has closed." |
| display topology changes | "The display layout changed, so I need to look again." |

Plus one that pins the whole point: no outcome's message may contain "screen
moved" or "screen changed", and an outcome that proceeds must say nothing at
all — a successful recovery announced as a failure is the defect in a quieter
form.

## COMPLETE — the two failing suites, repaired

Both were tests encoding behaviour the product had deliberately moved past.
Neither was skipped or reclassified.

**`test:prefs`** required `models.roles.assistant` to be null when unset and to
stay null when cleared. True when every role defaulted to null; false since the
product decided the app must always have a chat model — an assistant of `null`
is an app that cannot answer anything, and `normalizePrefs` also refuses to
leave a voice or local-only model in that slot. The assertions now state that
invariant, *and* keep what they were protecting by checking it against the roles
that genuinely are optional: `screen` and `image` still stay null both when
unset and when explicitly cleared.

**`test:errors`** required the missing-key message to contain "Settings →
Models" and to name no provider at all. The page is now "Voice & AI keys" and
the message names the two keys the user has to save. The rule worth keeping is
that a missing key reads as setup rather than failure, so the assertion now
checks that: it points at a settings page, does not say anything failed, and
does not attach a failure word to a provider name. Naming what to add is not
blaming what broke.

## Suite state

- `cargo test --lib` — **471 passed, 0 failed**, 11 ignored (live-hardware tests)
- `cargo clippy --lib` — no warnings in the new modules
- `npx tsc --noEmit` — clean
- `npm run build` — succeeds
- **46 TypeScript suites — all passing, none excluded**

---

# Annotation manager

## Phase 1 — what was already there

| Piece | Owner | Verdict |
| --- | --- | --- |
| `native_overlay.rs`: three singleton windows, class `ArcSonareOverlay`, one background thread owning the message loop | `init()` | reuse — window class, `create_window`, `paint`, `Surface`, click-through |
| `show_highlight` / `hide_highlight` | one global `HIGHLIGHT_HWND` | insufficient — one rounded rectangle, one at a time, no identity. A border and a circle could not coexist because the second call moved the first window |
| `overlay_window_census()` | enumerates by class name, asks Windows directly | reuse as-is; already the right shape for a leak check |
| `preview_visual_target` → `visualTarget.ts` | the only annotation caller | reuse — resolution, authority gate and freshness unchanged |
| `clear_visual_overlay` | hides highlight + pointer | replaced — no notion of *which* annotation |
| `ConversationEntity` (`visual-target` type, `ref` + `meta`, deliberately no stored coordinates) | `conversationContext.ts` | reuse for person/face/annotation ids |
| coordinates, negative origins, `VisualExecutionAuthority`, freshness, `target_search` | `display/` | reuse unchanged |

No second overlay implementation was created. The new windows use the existing
class, so the existing census counts them.

## Phase 2–3 — the manager

`src-tauri/src/annotations/`:

- `mod.rs` — `AnnotationManager`: stable ids, account/conversation/request
  ownership, source window and monitor, target and *parent* target, shape,
  geometry, style, z-order, lifecycle (`active` / `hidden` / `stale` /
  `removed`), temporary flag. Create returns an id; update and remove take one.
- `shapes.rs` — signed-distance rendering for highlight, rectangle, circle,
  arrow, label. Colour names resolve here, and an unknown colour is refused
  rather than drawn as something arbitrary.
- `commands.rs` — the twelve IPC commands, including `annotation_census`.
- `native_overlay.rs` — a tracked window pool. Handles are returned to the
  manager rather than stored in a static, which is what let the old code orphan
  visible windows it could no longer hide.

Three decisions worth naming:

**Repeating a create returns the existing id.** A redelivered tool call must not
stack two borders on one person.

**Restore marks annotations `stale`, not `active`.** The window may have come
back somewhere else; drawing at the old coordinates would put a border around
nothing. Supplying new geometry clears the staleness.

**The census counts windows twice** — from the manager's map and from the
overlay pool — because a difference between them is exactly what a leak is.

## Phases 4–11 — automated

26 Rust tests. The whole conversation as one test, plus each requirement
separately: stable ids, coexistence, update-one, remove-one-keep-one, clear,
duplicate creates, wrong account, wrong conversation, removed-cannot-update,
source close, minimise, restore, window movement, negative-origin monitor,
census reaching zero, face containment, undrawable geometry refused.

Four capabilities added — `screen.annotate`, `screen.update_annotation`,
`screen.remove_annotation`, `screen.clear_annotations` — all `reversible`, and
`check-permission-policy` now asserts that the whole conversation, including two
target re-resolutions, produces **zero** permission prompts.

## Not yet physical

`src/services/annotationService.ts` exists and typechecks, but the frontend
executors for the four capabilities are not written, so the conversation cannot
yet be run in the app. Everything above is PARTIAL until it is.
