# Chat intelligence and presentation

Audit + repair of the production chat path: what it answers with, what it shows,
and what it must never show.

- Branch `master`, HEAD at audit start `a8c1787`.
- Scope: connection questions, tool-selection provenance, surface follow-ups,
  response planning, footer metadata, source icons, recommendations, the
  thinking indicator, and auto-scroll.
- Out of scope and untouched: Running Apps / Watch, Display Mapping, task
  durability, the voice session guard, the conversation ledger's design.

---

## 1. Audit — what the code actually did

### Production chat flow

```
CommandComposer.submit
  → AssistantService.askAssistant
      → openedAppsService.answerRunningAppsQuestion      (desktop heuristics)
      → capabilityEngine.handleCapabilityRequest         (the action path)
          → IntentClassifier.isOrchestratedDomain → bail to orchestrator
          → clarifyGuards (missing title / missing query)
          → capabilityRouter.retrieveCapabilities        (top-N schemas)
          → provider tool call (DeepSeek, native tools)
          → capabilitySchemas.validateArguments
          → productionBridge.resolvePronounArguments     (pronoun / surface gate)
          → executeCapability → native `capability_execute` | frontendExecutors
          → productionBridge.recordEntitiesFromResult    (ledger deposit)
      → styleAssistantOutput                             (presentation)
      → IntentOrchestrator.handleOrchestratedRequest     (Gmail/Calendar/Drive)
      → plain model chat                                 (conversation)
```

`routeDeterministic` exists in `capabilityRouter.ts` and is **not** called by the
production chat path. That is unchanged: capability *selection* remains
model-driven; only *retrieval* is deterministic.

### Connection state — the real source of truth

`services/integrationStatusService.ts::getConnectedIntegrationIds()` is what the
Connect page reads:

- Google integrations (`gmail`, `googleCalendar`, `googleDrive`, …) come from the
  native `google_oauth_status` command.
- Everything else, YouTube included, is a Windows Credential Manager check:
  `secure_storage_has("integration.youtube")`.
- `ConnectionBroker` (localStorage `arcsonare.connectionMeta.v1`) holds validation
  timestamps and expiry, and is the only place `authentication-required` is
  observable. It is populated for Google only.

YouTube is a real Connect integration (`config/integrationCatalog.ts`, credential
field `apiKey`; `data/demoData.ts` id `youtube`).

### Where connection questions were interpreted — and the hole

`IntentClassifier` had connection branches for **email, calendar and drive only**
(`object: "connection"` → `email.get_connection_status` etc. via
`IntentCapabilityMap`). Any other service fell straight through
`isOrchestratedDomain` into model tool selection, where the only schemas matching
"YouTube" were `web.search`, `web.open_url` and `web.activate_listed_item`.

**So "is YouTube connected?" had no correct answer available to the model.**
Opening a browser was the best of the tools it was given. That is the defect.

### Where `web.search` / `web.open_url` run

Selected by the model in `capabilityEngine.runModelToolLoop`, executed natively in
`src-tauri/src/capabilities/web.rs` (`search`, `open_url`) via
`executor.rs`. `web.search` returned `{ url, site }` — **not the query**, which is
why the surface context for a follow-up had no idea what had been searched for.

### Where the response is composed / where the name is inserted

`services/styleAssistantOutput.ts` is the single presentation gate. It already
consulted `conversationContext.shouldUseUserName()` and accepted an `entityRef`
for discovery suppression — but **no caller ever passed `entityRef`**, so the
"don't re-announce the find" rule was dead code.

### Footer metadata and icons

`pages/DashboardPage.tsx::ChatBubble` rendered `agentForTool · labelForTool ·
message.source.label`, where `source.label` was `styled.sourceHint` — literally
`"DeepSeek · deepseek-v4-flash"` or `"DeepSeek V4 Flash · natural"`. There were no
result icons anywhere in chat.

### Thinking UI

Inline in `ChatBubble`: three pulsing dots plus `message.status`. Statuses were set
from `AssistantService` as `"Formatting with DeepSeek V4 Flash…"` and
`"Asking DeepSeek V4 Flash…"` — the vendor name, on screen, on every tool turn.

### Scroll container

`.chat-bubble-list` in `DashboardPage`, with a `stickToBottomRef` updated on
scroll and one effect keyed on `messages.length / text / pending`. It could not
see late growth: images decoding, capture previews mounting, or the feedback row
appearing all happen after that effect has run.

### Test baseline (before any change)

31 node suites run; 29 fully green. Two pre-existing failures, both unrelated to
chat presentation and **left alone**:

- `test:errors` — 1 failure, wording of the missing-API-key message.
- `test:prefs` — 2 failures, null model roles being replaced by a default.

---

## 2. Connection-status behavior

New capability **`connections.get_status`** (`capabilityRegistry.ts`, executor
`frontend`), backed by `features/capabilities/connectionStatus.ts`:

- `resolveServiceId()` maps the user's words to a Connect integration id via
  `INTEGRATIONS` names/ids plus a small non-colliding alias table. An
  unrecognised name returns `unknown-service` — it never guesses.
- `readServiceConnection()` reads `getConnectedIntegrationIds()` (the same call
  the Connect page makes) and, for Google, the broker's account record.
- Returned states: `connected`, `not-connected`, `needs-reauth`, `error`,
  `unknown-service`, plus `credential_present`, `account`, `last_validated_at`
  and the integration's capability list.
- **No secret is read or returned.** Credential *presence* is a boolean.

Tool descriptions now separate the four things that were being confused:

| Intent | Tool |
| --- | --- |
| check connection | `connections.get_status` |
| connect a service | `arcsonare.navigate` → `connect` |
| open a service | `applications.open` / `web.open_url` |
| search a service | `web.search` |

`web.search` and `web.open_url` descriptions now say explicitly that they are
never the answer to a connection question. `filesystem.find` says it is local
disk only, so "find X on YouTube" cannot be read as a file search.

This is **not** keyword execution: nothing routes deterministically. Retrieval
scoring simply puts the right schema in front of the model —
`connections.get_status` scores 19 against `web.search`'s 3 for
"can you check if youtube is connected".

## 3. Tool-selection provenance

`features/capabilities/executionTrace.ts` records, per tool call: user request,
model request id, provider completion id, tool call id, capability, structured
arguments, the full retrieval candidate list, validation outcome, executor,
result status/summary and duration. Recorded *before* validation, so a rejected
call is visible too.

The provider completion id is now carried through: `deepseek.rs` attaches
`__completion_id` to the returned message and `providerToolAdapter` surfaces it as
`AdapterReply.responseId`.

Developer-only by construction — read from the console via
`window.__arcsonareTrace.all()` / `.run(runId)`. Nothing renders it in chat.

## 4. YouTube context

- `web.rs::search` now returns `query` alongside `url` and `site`.
- `productionBridge.recordSurface` prefers the returned `site` over URL sniffing,
  so the surface is `{ kind: "youtube", label: "YouTube", query: "Cleo Abram" }`.
- `resolvePronounArguments` guards a surface-relative request ("here", "there",
  "on this page") two ways when the surface is not the Desktop:
  - a Desktop/filesystem reader can never answer it;
  - a screen action (`screen.click_target`, `screen.highlight_target`,
    `input.click_at`) can only answer it if the user **named** the target in that
    turn. A blind click is refused, not aimed.
- Refusal is a question, not an error: *"Do you want me to show the Cleo Abram
  results here in chat, or bring YouTube to the front?"* Inline YouTube results
  are not implemented, and the question says so honestly rather than pretending.

## 5. Response planning

`features/conversation/responsePlan.ts` — one place that decides structure from
the real `ToolResult` plus the ledger:

| Field | Rule |
| --- | --- |
| `outcome` | success / failure / clarification, from the result status |
| `facts` | verified text; the model may rephrase, never contradict |
| `entityRef` / `entityLabel` | structured identity of the thing acted on |
| `newlyDiscovered` | false when the entity was announced in an earlier turn |
| `mayUseName` | success turns only, and only past the ledger's cooldown |
| `source` | bundled icon key + plain-language label |
| `actions` | at most two, each a real capability with real arguments |
| `showTechnicalDetails` | always false for normal chat |

`styleAssistantOutput` now accepts the plan and defers to it instead of
re-deciding, and `AssistantService` finally passes `entityRef`.

**Ledger bug found and fixed while testing this.** `rememberEntity` refreshed
`sourceTurn` every time the same entity was re-recorded. Acting on the books
folder a second time therefore made it look brand new on the very turn that was
following up on it — which is why "highlight it" still opened with "I found the
books folder". `sourceTurn` is now first-sighting and never refreshed.

## 6. Name policy

- The name may appear at most once per `NAME_COOLDOWN_TURNS` (6) turns —
  structurally, from the ledger, not from prompt wording.
- Failure and clarification turns never use it.
- A follow-up whose entity is already known is told, as ground truth, not to
  re-announce the discovery.
- `services/nameGreeting.ts::stripGreetingName()` removes a forbidden greeting
  from the finished reply. Needed: live, with the cooldown active and the prompt
  saying "do NOT use it in this reply", the model still returned "Hey Robera,
  opened a youtube search…". Only vocative positions are touched — a name inside
  real content (a file named after them) is left alone.

**Second production gap found and fixed.** `recordTurn` was never called by the
running application — only by its own tests. `turnCounter` therefore sat at 0
forever, so the cooldown could never expire and no entity could ever count as
already discussed. `askAssistant` now records the user turn on entry and the
assistant turn on exit, excluding internal presentation prompts (which are the
assistant talking to itself and would age the cooldown against turns the user
never saw).

## 7. Recommendations and action chips

At most two, and only after a success:

| After | Chips |
| --- | --- |
| found a Desktop item | Open folder · Highlight |
| highlighted an item | Open folder |
| created a task | Due tomorrow · Mark high priority |
| updated a task | whichever of due date / priority is still unset |
| YouTube search | Open the first video |
| service not connected | Open Connect |
| connection error / expired | Review connection |
| YouTube connected | Open YouTube |

Each chip carries `{ capabilityId, args }` and calls `executeCapabilityById`
directly. Chip text is never sent back through the model — the choice is already
made, and re-parsing it is another chance to get it wrong.

## 8. Source icons and footer cleanup

`components/chat/SourceIcon.tsx` resolves an icon key in this order:

1. **Connect integration icons** (`integrationIcons`, via the same
   `resolveServiceId` the connection capability uses) — the logos the user
   already recognises from their own integrations list. Chat showing a different
   mark for the same service reads as a bug even when nothing is broken.
2. Desktop app icons from the shared asset folder (Chrome, Edge, Firefox,
   Brave, VS Code) for apps with no Connect entry.
3. The top-overlay SVG pack.
4. **The bundled application icon library** — `src/assets/app-icons`, 871 marks
   moved in from the repo-root `ICO/` folder, matched by
   `config/appIconMatch.ts`. This is the long tail: After Effects, Premiere Pro,
   Blender, DaVinci Resolve, Steam, Postman, Calculator — anything the user
   might open that nobody curated a mark for.
5. A drawn lucide glyph for concepts: folder / task / connection / browser /
   system.

**Nothing is fetched at render time.**

Matching is exact name → unambiguous vendor-stripped alias ("After Effects" for
"Adobe After Effects") → whole-word containment with a single winner. Ambiguity
returns nothing rather than guessing: the wrong app's logo beside a result is a
small lie about what happened. `"Adobe"`, `"it"` and `"a"` all match nothing.

Three fixes after live looks at the footer:

- **A concept key must never match an app.** `folder` was hitting the overlay
  pack's File Explorer entry (whose aliases include "folder"), so "Folder read"
  drew a Windows Explorer logo. Concept keys now short-circuit to a glyph and
  never enter the image path.
- **The mark must fill its circle.** The first version clipped a square icon
  against a round container; the second padded it inside a bordered disc, which
  left a small logo adrift in a large ring. A product logo is now full-bleed and
  circularly clipped, with no disc of its own. Only the drawn glyphs keep the
  translucent disc — an outline needs something to sit on — and bare brand marks
  keep the `is-framed` background the Connect page gives them.

**Cost, stated plainly:** the icon library adds **54.5 MB** to the build (`dist`
is 81 MB total; the frontend builds in ~7s). If that matters for the installer,
re-encoding the multi-resolution `.ico` files as single small PNGs would cut it
to roughly 5 MB with no visible difference at 20px. Not done — it is a
deliberate trade to decide, not one to make silently.

The footer is now `[icon] Friendly label` — "YouTube results opened", "Folder
highlighted", "Task updated", "YouTube connection checked". Model, provider,
version, mode, System/Assistant and capability ids are gone from normal chat;
`ChatMessage.source` still carries them for developer use but is not rendered.

## 9. ThinkingTool

`components/chat/ThinkingTool.tsx` replaces the inline dots-and-label. Uses
`ChevronRight` from `lucide-react` and the project's plain-CSS idiom.

Two notes on the brief, since both differ from what the repo actually contains:

- **The project has no Tailwind, no shadcn, and no `cn` helper.** It is plain CSS
  files under `src/styles/`. The component follows that, with a three-line local
  class joiner named `cn` for readability.
- **No `ThinkingTool` design was attached to the request.** The component is built
  to the described behaviour: safe progress text, a chevron disclosure, no model
  names, no reasoning. Swap in the real design when it is available.

`safeProgressText()` collapses anything naming a vendor, a model, a provider, or
an internal id to a plain "Thinking". The disclosure shows the steps this turn has
taken — never reasoning, because there is none to reveal and inventing some would
be theatre.

## 10. Auto-scroll

`DashboardPage`:

- `.chat-bubble-track` wraps the messages; `.chat-bottom-sentinel` sits below the
  complete last message (text, images, chips, feedback row).
- A `ResizeObserver` on the track catches late growth — decoded images, mounted
  previews, the feedback row — and follows only when the user is within 72px of
  the bottom.
- Scrolling up sets `newContentBelow` instead of yanking the viewport; **Jump to
  latest** appears and scrolls to the true bottom.
- Returning to the bottom resumes following and clears the button.

---

## Automated tests

New: `npm run test:chat-presentation`
(`scripts/check-chat-presentation.mts`) — 33 assertions covering connection-tool
ranking, tool-description separation, service resolution, honest wording for an
unverifiable connection, the YouTube surface follow-up (Desktop refusal, blind
click refusal, named click still runs), the response plan (badge, no capability
ids, discovery vs follow-up, name cooldown, chip validity, failures offer
nothing) and progress-text sanitisation.

Regression run after the change — all green:

```
intent routing planner ownership files visual-dispatch voice prompt chat tasks
persistence events listing messages realtime click no-native confirm vision
pointer voice-session web-answer desktop-targeting planner-highlight
display-mapping display-refusal task-durability voice-safety
conversation-context conversation-wiring chat-presentation
```

`test:errors` (1) and `test:prefs` (2) still fail exactly as they did before this
work; both are unrelated and were not touched.

## Physical tests

Run against the debug build (`npm run tauri:dev`, PID confirmed as the dev
binary at `src-tauri/target/debug/arcsonare.exe`, with the Rust changes verified
present in the compiled image).

Ground truth established first, from the Connect page: **exactly one connector is
connected — YouTube** (Connected 1, Network pulse "Linked 1/42").

### PASS — connection question

> **Can you check if YouTube is connected?**
> Yep, YouTube's connected and ready to use.
> ● YouTube connection checked   ·   [Open YouTube]

- No browser opened; ArcSonare stayed in front.
- No web search ran.
- The status matches the Connect page.
- Footer is a YouTube icon plus a plain label — no model, provider, mode,
  System/Assistant, or capability id.
- One relevant chip.
- Reproduced on two separate fresh builds.

### PASS (with one defect found and fixed) — YouTube search

> **Can you find Cleo Abram on YouTube?**
> Hey Robera, opened a youtube search for "Cleo Abram".
> ● YouTube results opened   ·   [Open the first video]

- Went to web search, **not** `filesystem.find` — the local-disk misroute did not
  happen.
- Exactly one browser action: Running apps picked up
  `Edge — Cleo Abram - YouTube and 1 more page`.
- Clean YouTube icon and label; no model metadata.

Three defects were visible in the first live run, all fixed and then re-verified
on screen:

1. **"Hey Robera,"** — the name, on the turn right after one that had already
   consumed the allowance. Two causes. The style instruction carried three
   worked examples literally spelling `"Hey {name}, …"`, demonstrating the
   opening the adjacent line forbids; and `deterministicNaturalReply` builds its
   own `"Hey {name}, "`, while the name decision was made *after* the fallback
   was constructed — so all three fallback exits wrote the greeting the policy
   had just forbidden. Fixed on both sides: the examples go name-free when the
   name is disallowed, the decision now precedes the fallback, and
   `stripGreetingName()` is applied at every exit.
2. **"a youtube search"** — the site name reached the user verbatim from Rust in
   lowercase. `web.rs` now carries a display label (`YouTube`, `Google`, `Bing`,
   `GitHub`).
3. **A footer that claimed an action that never happened.** "Show me here" was
   answered with a clarifying question and the badge still read "Highlighted on
   screen" — the label of the capability the model *asked for*, not of the one
   that ran. `buildResponsePlan` now derives the badge from the outcome:
   clarification → "Waiting on your answer", failure → "Didn't go through".

### PASS — context follow-up

> **Can you find Cleo Abram on YouTube?**
> Opened a YouTube search for "Cleo Abram".
> ● YouTube results opened · [Open the first video]
>
> **Show me here.**
> Do you want me to show the Cleo Abram results here in chat, or bring YouTube to the front?
> ● Waiting on your answer

- YouTube retained as the surface, "Cleo Abram" retained as the query.
- No Desktop listing. No click target. No name on either reply.
- Inline results are not implemented, and the question says so rather than
  pretending otherwise.

### PASS — tone

> **Find the books folder on my Desktop**
> Found it — your **books** folder is right on the Desktop. It's at `C:\Users\rober\Desktop\books`
> ● Found on your Desktop · [Open folder] [Highlight]
>
> **Highlight it**
> That's "books" — I've put a border around it so it stands out on your Desktop.
> ● Highlighted on screen · [Open folder]

- No name on either reply; no "Done —"; no "I found it" the second time.
- The follow-up drops the Highlight chip and offers only what is left to do.

### PASS — ThinkingTool

Live during a two-step turn: "Writing the answer…" with the chevron disclosure
expanding to the steps taken so far. No vendor name, no model name, no reasoning.

### PASS — auto-scroll

- A 90-item folder listing: complete message, badge and feedback row all visible
  with no manual scrolling.
- A screenshot reply whose image decodes *after* the text: the view followed the
  image down to the true bottom — the ResizeObserver case the old
  message-count effect could not see.

### PASS — Jump to latest

Scrolled up mid-history, then sent a new message: **no forced scroll**, the view
stayed where it was, **Jump to latest** appeared, and clicking it landed on the
complete newest reply including its feedback row. Following then resumed and the
button disappeared.

### Known rough edge

Capabilities without a dedicated status line show "Working…" in the ThinkingTool
step list. Safe, but vague — worth a pass over `statusLineFor` later.

---

# Part 2 — response provenance and the unified message

The tools were choosing correctly, but the chat still read as hard-coded:
actions completed instantly, final sentences repeated a handful of shapes, and
the Thinking UI was a detached panel stacking "Thinking / Working / Thinking /
Working" before a separate card appeared with the answer.

## Final-response provenance audit

Every path that can produce a user-visible answer, traced from source.

| # | Path | Model call? | Tool result → model? | Class | Used after success? |
| --- | --- | --- | --- | --- | --- |
| 1 | `AssistantService` running-apps branch → `styleAssistantOutput` | yes | facts string | MODEL_GENERATED | n/a |
| 2 | `web.fetch_page` + image intent → `localBrowserReply` | no | — | DETERMINISTIC_FALLBACK | yes |
| 3 | `web.fetch_page` ok → `styleAssistantOutput(useModel:true)` | yes | page facts | MODEL_GENERATED | yes |
| 4 | `web.fetch_page` fallthrough → `localBrowserReply` | no | — | DETERMINISTIC_FALLBACK | on failure |
| **5** | **main tool branch → `styleAssistantOutput(useModel: !shortAction)`** | **no when `shortAction`** | — | **DETERMINISTIC_FALLBACK as the default** | **yes** |
| 6 | main tool branch, non-`shortAction` | yes | facts string | MODEL_GENERATED | yes |
| 7 | `styleAssistantOutput` model rejected / timed out | no | — | DETERMINISTIC_FALLBACK | yes |
| 8 | `isModelRefusal` guard → raw `responseText` | no | — | DETERMINISTIC_FALLBACK | yes |
| 9 | orchestrated (Gmail/Calendar/Drive) → `styleAssistantOutput` | yes | facts | MODEL_GENERATED | yes |
| 10 | `capabilityResponseComposer.composeResponse` | no | — | template (produces the facts; final text for voice) | yes |
| 11 | clarification via `resolvePronounArguments` | question is a template, then styled | mixed | CLARIFICATION_TEMPLATE | n/a |
| 12 | engine error paths (provider unavailable, invalid args, step limit) | no | — | ERROR_TEMPLATE | no |
| **13** | **`continueModelLoop` final text after a successful tool** | **yes** | **yes** | **MODEL_GENERATED — then discarded** | **yes** |

### The two causes

**#5 — the presenter was told not to use the model.** `shortAction` was true for
`web.search`, `web.open_url`, `web.activate_listed_item`, `screen.click_target`,
`applications.open/close/focus`, and *any* error. For all of those,
`useModel = !shortAction` was `false`, so `styleAssistantOutput` returned
`deterministicNaturalReply()` — a template bank whose outputs are literally
`Opened ${app}.`, `Clicked “${label}”.`, `Hey ${name}, …`. Zero model
involvement in the wording of the most common actions in the app.

**#13 — the model's answer was already being written, and thrown away.** The
loop sends the tool result back and the model replies; on success the engine
replaced that sentence with `composeResponse()`. **The second provider call was
already being paid for and its output discarded.**

## What changed

- The loop now **keeps** the model's post-tool sentence, gated by
  `finalTextJudge.judgeFinalText()`: empty, over-long, leaking an internal id or
  a vendor name, or contradicting the verified outcome → rejected, and the
  deterministic text is used with the reason recorded.
- Before that reply is written, the engine pushes a **restricted contract**
  (`buildFinalResponseContract`) carrying the original request, the outcome, the
  verified facts, the name policy, the already-known/newly-discovered state, and
  the single allowed follow-up. No logs, no capability ids, no provider chatter.
- `AssistantService` no longer re-templates a `MODEL_GENERATED` answer; it only
  enforces the name policy over it.
- Provider calls and tool executions are counted and recorded per answer.

Deterministic text is now a documented fallback, not the default.

## Unified message lifecycle

One shell from placeholder to answer:

```
assistant message
  ├─ Thinking row (live, one status)   →   Thought row (collapsed, past tense)
  ├─ final response text
  ├─ friendly source row
  ├─ optional image / action chips
  ├─ dev diagnostics (DEV builds only)
  ├─ feedback controls
  └─ bottom sentinel
```

`ThinkingTool.tsx` exports `ThinkingRow` and `ThoughtRow`; the detached
`.thinking-tool` panel and its accumulating step list are gone.

## Status deduplication

`features/chat/statusReducer.ts` collapses the event stream into `current` (the
one live line) and `steps` (the actions only). Generic waiting never becomes a
step; repeats collapse; capability-specific wording wins over "Working…".

Two honesty fixes found while verifying:

- **Composing the reply is not a step.** It happens on every turn, so it gave a
  plain "7 times 6 is 42" answer a Thought row reading only "Wrote the reply".
- **The orchestration status fired speculatively**, before the orchestrator had
  decided anything, so "what is the capital of Japan?" recorded "Checked your
  connected services" as something that happened. It now fires only for a
  request the classifier actually routes to a connected service.

Also fixed: the diagnostics row attached the *previous* answer's provenance to a
turn that ran no tool. It is now attached only when a new record was written.

## No artificial delay

Nothing was slowed down. Fast turns show a brief Thinking row and become the
answer; the row reflects real work only.

## Physical verification

| Test | Result |
| --- | --- |
| A — YouTube search | `Tool selection MODEL` · `Capability web.search` · `Tool execution SUCCEEDED` · `Final response MODEL_GENERATED` · `Provider calls 2` · `Tool executions 1` |
| B — connection status | `Capability connections.get_status` · `MODEL_GENERATED` · `Provider calls 2` · `Tool executions 1` · no browser opened |
| C — fallback | Automated only (5 rejection reasons + `verdict.ok ? candidate : facts`). Not physically triggered — forcing a provider failure means changing the user's settings. |
| Thinking | One compact inline row, one status, no list, no panel |
| Transition | Same shell becomes the answer; Thought collapsed above it |
| Auto-scroll | Short, long, late image, chips, feedback all followed to the true bottom |
| Jump to latest | Appears when scrolled up, no forced scroll, reaches the complete bottom |

Naturalness, same request on two runs:

> I've got a YouTube search for "Cleo Abram" open now, Robera — take a look. Want me to open the first video?

> Done, Robera — I've pulled up a YouTube search for Cleo Abram. Want me to open the first video?

The second opened with "Done," so the contract now forbids that and the other
stock openers by name.
