# Running Apps and "Watch list" — read-only audit

Audited 2026-08-01 against Git HEAD `a8c1787`, debug build PID 6736. No code was
modified.

## Executive summary

There is no watch list. There is a **set of catalog IDs in localStorage** that
biases the assistant's system prompt.

Clicking an app in the Running Apps card does not focus it, open it, capture it,
or register it anywhere native. It toggles membership of a `Set<string>` of
curated application IDs. The only consequence is that the system prompt tells the
model to *prefer* those apps when answering "what's running?".

What ArcSonare knows about a "watched" application is its **window title**, and
nothing else. There is no screen capture, no UI Automation, no accessibility
tree, no application API, and no adapter — for Discord, VS Code, or anything
else. `application_adapter`, `ui_automation` and `browser_automation` are
hard-coded `false` in
[`src-tauri/src/interaction/commands.rs:45-47`](../../src-tauri/src/interaction/commands.rs),
and `ExecutionStrategy::UiAutomation` returns
*"has no implementation in this build."*

So "What is happening in Discord?" cannot be answered from Discord's contents
today. At best the model sees Discord's window title. In fact that phrasing does
not even reach the running-apps path — see Chat integration.

The monitoring model is **passive metadata only**, closest to *"Passive watch"*
in the requested taxonomy, and the word "Watch" in the UI overstates it.

## Running Apps card

| Aspect | Finding |
| --- | --- |
| Component | `OpenedAppsCard` — `src/components/dashboard/OpenedAppsCard.tsx` |
| Data source | `detectOpenedContextApps()` — `src/services/openedAppsService.ts` |
| Watch state | `useActiveContextApps()` — `src/features/dashboard/contextActivationStore.ts` |
| Two-item rule | `const VISIBLE_ROWS = 2` (line 24). **Hard-coded**, not derived from height |
| Scrolling | A sliding window over the array, not overflow scroll. Height is locked to exactly two rows (`lockedHeight`, lines 118-127) |
| Chevron | `pageBy(+1)` / `pageBy(-1)` — moves the window one row. Does **not** expand, open a page, or open a drawer |
| Wheel | Same paging, one row per notch (lines 105-116), `preventDefault` when more than two apps |
| Click | Whole row is one `<button>`; the only handler is `toggleContextApp(app.id)` (line 209) |
| Icon vs name | No difference — both are inside the same button |
| Hover action | None |
| Right-click | None |
| Keyboard | Inherited from `<button>` — focusable and Enter/Space activate. `aria-pressed={active}` and a descriptive `aria-label` are set |
| Selected state | `is-active` class plus a `CheckIcon` badge on the icon |
| Empty state | `EmptyState` "No apps open" |
| Loading state | `EmptyState` "Scanning…" |
| Error state | **None.** `refresh()` catches and logs to console only (lines 55-57); the card silently keeps the previous list |
| Count badge | `{activeIds.length} watching` |

**Observed.** The card displayed an up chevron *and* a down chevron at the same
time with two rows visible. Clicking the down chevron changed the rows from
`YouTube, Spotify` to `Spotify, Chrome` — one row of travel, card height
unchanged. Paging is confirmed; expansion does not exist.

## App discovery

Two capabilities, run in parallel every refresh
(`openedAppsService.ts:90-103`):

- `system.get_running_processes` → `src-tauri/src/capabilities/system.rs:287`,
  which uses `CreateToolhelp32Snapshot` (line 235).
- `windows.list` → window enumeration via `EnumWindows`.

Results are matched against a **curated catalog**,
`src/features/dashboard/contextAppCatalog.ts`. An application that is not in the
catalog can never appear, however obviously it is running.

Matching is by normalised executable name (`processMatches`) and by window-title
substring (`titleMatches`). Browser tab destinations (YouTube, Amazon, Netflix,
Udemy) are matched by title on browser-like processes only.

**Fields actually retained** per app (`OpenedContextApp`, lines 17-31):
`id`, `displayName`, `kind`, `kindLabel`, `contextHint`, `iconSrc`,
`integrationIconId`, `processName`, `windowTitle`, `viaBrowserTab`.

**Fields not retained:** process ID, window handle, executable path, monitor,
bounds, minimised state, foreground state, last-active time, account ownership,
sensitivity. The PID is available from the process row and is discarded.

**Deduplication.** `hits` is a `Map` keyed by **catalog id** (line 118). One row
per catalog application, never per window or per process:

- Multiple Discord windows → one row.
- Multiple VS Code windows and multiple workspaces → one row, with a single
  "best" title chosen by `bestTitleForProcess` (longest / has a separator).
- Browser windows → one row per browser, plus separate rows for recognised tab
  destinations.
- Child windows, background processes with no window, minimised windows, UWP and
  elevated applications are not distinguished at all — they either match the
  catalog by process name or are invisible.

The list is capped at 14 and sorted newest-first using a session-local
`firstSeenAt` map, which is lost on reload.

## Watch list

There is no `WatchedApp`, `WatchTarget`, `AppWatch`, `watchList` or
`monitoredApps` type anywhere in the repository. The searches returned nothing.

**Actual schema** — `src/features/dashboard/contextActivationStore.ts`:

```ts
let active: Set<string>;   // catalog ids, e.g. "discord", "vscode"
let watchAll: boolean;     // auto-watch every newly detected app
```

| Question | Answer |
| --- | --- |
| Tied to a process ID? | No |
| Tied to an executable path? | No |
| Tied to a specific window? | No |
| Survives the application restarting? | Yes — the id matches again on the next poll |
| Survives ArcSonare restarting? | **Only if the app is still running.** `syncContextActivations` deletes any watched id not currently detected (lines 138-143) |
| Account-specific? | **No.** Plain localStorage, no user id in the key |
| Conversation-specific? | No |
| Persistence | `localStorage` keys `arcsonare.dashboard.contextApps.active.v1` and `...watchAll.v1`. **Not SQLite** |
| Maximum watched | None, but only 14 apps can ever be detected |
| Unwatch | Yes — click the row again, or the composer Watch pill (`toggleWatchMaster`) |

Because state is pruned to what is currently open, "watching" cannot outlive the
application it points at. Closing Discord silently unwatches it.

## Monitoring model

**Passive watch — metadata only.**

Watching triggers no capture of any kind. The card polls every 8 s
(`POLL_MS = 8_000`) plus on window focus, and that poll enumerates processes and
window titles for *all* catalog apps regardless of watch state. Watching changes
only which entries are labelled "Watching" in the prompt and answer text.

It is not *Active watch* (nothing is continuously collected beyond titles that
would be collected anyway) and not *On-demand inspection* (asking a question does
not inspect the application — it re-reads titles).

## Chat integration

Two paths, both title-only.

**1. System prompt injection.** `formatDesktopContextForAssistant()`
(`openedAppsService.ts:400`) is placed under the heading *"DESKTOP / RUNNING APPS
— verified live from the user's PC"* with the instruction *"Prefer WATCHED apps"*
(`src/services/assistantPrompt.ts:148-160`). The model therefore receives app
names and window titles on every turn, whether or not the user asks.

**2. Pre-router interception.** `AssistantService.ts:207` calls
`answerRunningAppsQuestion(text)` **before capability routing**. If
`isRunningAppsQuestion()` matches, the answer is composed entirely from window
titles by `describeOpenedApp()` and then re-worded by `styleAssistantOutput`.
No tool is called.

`describeOpenedApp` has bespoke title parsers for YouTube, Amazon, Netflix and
browsers. There is **no Discord or VS Code parser** — both fall through to the
generic `"<name> is running. Window: "<title>"."`.

Answers to the required questions:

1. Does the model receive the watch list automatically? **Yes**, in the prompt.
2. Only app names? Names **plus window titles**.
3. Live content? **No** — titles only, refreshed at question time.
4. Stale cached content? The prompt line is built per turn, so it is fresh to
   within the enumeration call. The card's own list can be up to 8 s stale.
5. Does it call a tool? **No** for the intercepted path.
6. Which tool? None. (`system.get_running_processes` is used by the detector, not
   by the model.)
7. Does it know the active window? **No** — foreground state is discarded.
8. Does it know which row was selected? Only via the "Watching" grouping.
9. Can it distinguish Discord from VS Code? Yes, by name and title.
10. Does "it" resolve to the last selected app? Partially — `toggleContextApp`
    calls `rememberFocusedApp(displayName)` (lines 84-94), which feeds
    `src/features/capabilities/focusContext.ts`. That is a **name string**, not
    an entity reference.

Real chain:

```
user question
  → isRunningAppsQuestion() text match
  → detectOpenedContextApps()  (process + window enumeration)
  → filter by watched ids
  → describeOpenedApp()  (window-title string parsing)
  → styleAssistantOutput()  (model rewording)
  → reply
```

## Application-specific support

| App | Classification | Evidence |
| --- | --- | --- |
| Discord | **Generic window target** | `contextAppCatalog.ts:90-98` — `processNames: ["discord","discord.exe"]`, `titleHints: ["discord"]`. Nothing else |
| VS Code | **Generic window target** | `contextAppCatalog.ts:188-196` — `processNames: ["code","code.exe"]` |
| Browsers | Generic + title parsing | `describeOpenedApp` browser branch; tab destinations via `requireTitleHint` |
| YouTube / Amazon / Netflix / Udemy | Title parsers only | `describeOpenedApp` |
| Slack, Teams, Zoom, Spotify, Cursor | Catalog entries only | `contextAppCatalog.ts` |

**Discord** — ArcSonare cannot read server names, channel names, messages, unread
state, current conversation, or notifications. It can read whatever Discord puts
in its window title.

**VS Code** — ArcSonare cannot read the workspace, editor text, diagnostics,
terminal output, or Git state. The window title usually contains the active file
and folder, so *"what file is open in VS Code"* is answerable **only** because
the title happens to contain it — and only for the single window whose title won
`bestTitleForProcess`.

## Example questions

| Question | What happens today |
| --- | --- |
| **A. "What's happening in Discord?"** | `isRunningAppsQuestion` does **not** match — no "open/running" keyword, and Discord is not in the site list (`runningAppsQuestions.ts`). Falls through to capability routing / plain chat. The model answers from the prompt's desktop line, i.e. Discord's window title. **Likely failure mode: a confident answer built from a window title, or an invented one.** |
| **B. "What file is open in VS Code?"** | Same non-match, same path. Answerable only if the VS Code window title contains the filename, and only for one window. |
| **C. "What is happening in my watched apps?"** | The loose branch may match on "…running/open…"; if it does, the answer lists watched apps and their titles. **No multi-app summarisation of content exists.** |
| **D. "Open it."** | No follow-up resolver exists (audited in the previous task and still open). `rememberFocusedApp` stores a display name only. |
| **E. "Stop watching Discord."** | **No unwatch intent exists.** No capability, no router entry. Unwatching is UI-only. |

## Freshness

- Card list refreshes every 8 s and on window focus; no debounce, no
  cancellation of an in-flight refresh, no abort on unmount beyond clearing the
  interval.
- No timestamp is stored on any watched entry. `firstSeenAt` is ordering only and
  is lost on reload.
- No window-handle or PID identity is retained, so handle reuse and PID reuse are
  not detectable — and not applicable, since neither is stored.
- A process restarting under a new PID is invisible: the catalog id still
  matches, so the app appears continuously watched.
- Minimised windows are indistinguishable from visible ones.
- Stale answers are possible within the poll window, and nothing warns the user.

## Privacy and permissions

**Captured:** application names and **window titles**. Window titles routinely
contain document names and paths, browser page titles, Discord server and channel
names, and meeting names.

**Transmitted:** these titles are placed in the assistant system prompt on every
turn (`assistantPrompt.ts:148-160`) and therefore go to whichever model provider
is configured (`GeminiService`, `DeepSeekService`, or the Realtime session). This
is **not local-only**.

| Control | Status |
| --- | --- |
| Consent flow before collecting titles | **None found** |
| Per-app permission | None — the toggle is a preference, not a grant |
| Visible indicator while "watching" | The card badge and checkmarks only |
| Stop-watching control | Click the row, or the composer Watch pill |
| Redaction of titles | **None found** |
| Sensitive-window exclusion | **None found** |
| Retention | localStorage until pruned; titles are not persisted, only re-read |
| Screenshot storage | Not applicable — watching takes no screenshots |

Worth stating plainly: because titles are injected whether or not the user
watches anything, turning Watch off does **not** stop app names and titles being
sent.

## Performance

- One `system.get_running_processes` (a `CreateToolhelp32Snapshot` walk) and one
  `windows.list` (an `EnumWindows` walk, limit 120) every 8 seconds while the
  Dashboard is mounted, plus on every window focus.
- No screenshots, no OCR, no UI Automation, no GPU work, no disk writes beyond
  two small localStorage keys.
- No background threads; the interval is cleared on unmount.
- An in-flight refresh is not cancelled, so a focus burst can overlap polls.
- Costs are modest but are paid continuously regardless of whether anything is
  watched.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Watched app closes | Silently unwatched by `syncContextActivations` |
| Window destroyed | Not tracked |
| PID reused | Not tracked |
| Executable updated | Irrelevant — matching is by name |
| App restarts | Re-watched automatically if `watchAll`, otherwise silently dropped |
| Title changes | Picked up on the next poll |
| Minimised | Indistinguishable |
| Another display | Not tracked |
| Elevated app | Likely invisible to enumeration; no error surfaced |
| Enumeration fails | `runCapability` catches, logs to console, returns `null` → empty list → card shows "No apps open". **A failure is indistinguishable from nothing being open** |
| Refresh throws | Caught and logged; previous list retained silently |
| Two apps with the same title | Not possible to conflate — keyed by catalog id |

Errors are **silently swallowed** throughout this feature. None are surfaced to
the user, none are retried deliberately (the 8 s poll retries incidentally), and
none are converted into fake success.

## Tests

| File | Covers | Imports production code? |
| --- | --- | --- |
| `scripts/chat-quality-eval.mts` | 8 `watch`-category cases asserting `isRunningAppsQuestion` routing | Yes, the matcher |
| `scripts/check-voice-turns.mts` | Incidental mentions only | — |
| `scripts/live-watch-suite.mts` (`npm run test:watch`) | A manual live driver that fires utterances at a running app; not an assertion suite | Routing only |
| `scripts/suite-100.mts` | Incidental mentions | — |

**No coverage** for: watch/unwatch persistence, localStorage round-trip, pruning
on app close, deduplication, multiple windows, account isolation, cross-WebView
synchronisation, privacy/redaction, staleness, enumeration failure, or any
application content inspection.

## Status table

| Item | Status | Location | Evidence |
| --- | --- | --- | --- |
| Running Apps card renders live apps | COMPLETE | `OpenedAppsCard.tsx` | Observed showing YouTube, Spotify, Chrome |
| Two-at-a-time viewport | COMPLETE | `OpenedAppsCard.tsx:24,118-127` | `VISIBLE_ROWS = 2`, locked height |
| Chevron paging | COMPLETE | `OpenedAppsCard.tsx:241-249` | Observed one-row travel |
| Chevron expands the card | NOT IMPLEMENTED | — | No expand state exists |
| Click toggles watch | COMPLETE | `OpenedAppsCard.tsx:209` | `toggleContextApp` |
| Click focuses / opens the app | NOT IMPLEMENTED | — | No such handler |
| Watched visual state | COMPLETE | `OpenedAppsCard.tsx:195-229` | `is-active` + check badge |
| Watch list as a data model | NOT IMPLEMENTED | — | No `WatchedApp` type; a `Set<string>` |
| Watch persistence | PARTIAL | `contextActivationStore.ts:12,51` | localStorage; pruned to open apps |
| Survives navigation | COMPLETE | module-level store | State outlives unmount |
| Survives ArcSonare restart | PARTIAL | `contextActivationStore.ts:138-143` | Only while the app is still running |
| Account scoping | NOT IMPLEMENTED | `contextActivationStore.ts:12` | No user id in the key |
| Cross-WebView sync | BROKEN | `contextActivationStore.ts` | Writes localStorage but no `storage` listener; other webviews keep a stale in-memory set |
| App content capture | NOT IMPLEMENTED | `commands.rs:45-47` | `ui_automation = false`, `application_adapter = false` |
| Discord integration | NOT IMPLEMENTED | `contextAppCatalog.ts:90` | Catalog entry only |
| VS Code integration | NOT IMPLEMENTED | `contextAppCatalog.ts:188` | Catalog entry only |
| "What's happening in Discord?" | BROKEN | `runningAppsQuestions.ts` | Phrase does not match; no content source exists either way |
| Unwatch by voice/chat | NOT IMPLEMENTED | — | No intent, no capability |
| Multi-app summarisation | NOT IMPLEMENTED | — | Listing only |
| Follow-up "it" resolution | NOT IMPLEMENTED | `focusContext.ts` | Stores a display name string |
| Error surfacing | BROKEN | `OpenedAppsCard.tsx:55`, `openedAppsService.ts:65` | Failures logged to console; empty list looks identical to "nothing open" |
| Consent / redaction | NOT IMPLEMENTED | — | None found |
| Tests for watch behaviour | NOT IMPLEMENTED | — | Routing matcher only |
| Safe UI observation | COMPLETE | — | Card, chevron paging and watched state observed; no private content opened |

## Recommendations — not implemented, listed for discussion only

1. **Rename the UI concept or build the substance.** "Watch" implies ongoing
   observation. Today it is a prompt-preference toggle. Either wording should
   match (e.g. "Focus"), or watching should acquire real content.
2. **Decide the privacy posture before adding content.** Window titles already
   leave the machine on every turn with no consent step. Any move toward
   screenshots or UI Automation would multiply that considerably.
3. **Give the watch entry an identity.** A catalog id cannot distinguish two VS
   Code workspaces or survive an app closing. A record with executable path plus
   window identity would.
4. **Scope watch state to the account** and move it off bare localStorage, in
   line with the task store.
5. **Add a cross-WebView signal**, as was done for tasks, so the overlay and main
   window agree.
6. **Surface enumeration failures.** "No apps open" currently also means "the
   scan failed".
7. **Widen `isRunningAppsQuestion` or route these questions to a capability**, so
   "what's happening in X" is either answered honestly or declined — not answered
   from a window title as though it were content.
8. **Add an unwatch intent** if watching is kept.
9. **Add tests** for persistence, pruning, dedup and account isolation.
