# Conversation orchestrator and connected YouTube

Multi-turn conversation state, structured result sets, pending actions, and a
real connected-YouTube adapter.

Branch `master`. Nothing committed.

---

## The reported failure, and where the state was lost

```
User:      Find a MrBeast video on YouTube.
ArcSonare: [opens a browser search] …want me to open the first video?
User:      Yes.
ArcSonare: What do you mean?
```

Traced from source, the divergence is exact and has two parts.

**1. `"yes"` retrieves no capabilities at all.** `retrieveCapabilities("yes")`
returns an empty list, so `runModelToolLoop` reports `handled: false` and the
turn falls through to plain conversational chat. The model that answers has the
system prompt and session-action memory — and no idea a question was asked.

**2. There was nothing to find even if it had looked.** `ConversationContext`
had `pendingClarification` but no pending *action*. The recommendation existed
in exactly two places, neither durable:

- `ResponsePlan.actions[]`, rendered as chips into React component state;
- a sentence the model wrote into the reply text.

So the offer died with the render. `"open the first one"` was no better — it
retrieved `applications.open`, and there was no stored result list to index into
anyway.

**First divergence:** `buildResponsePlan` produced `actions` that were never
written to the conversation ledger. Everything after that follows.

## Status

| Area | State |
| --- | --- |
| Conversation state (account + conversation scoped) | **COMPLETE** |
| Result sets with stable ids and preserved order | **COMPLETE** |
| Pending actions | **COMPLETE** |
| Pending clarification | **COMPLETE** (pre-existing, unchanged) |
| Recommendation history | **COMPLETE** |
| Connected YouTube adapter | **PARTIAL** — implemented, not exercised against a live key |
| Inline results | **PARTIAL** — implemented, not seen on screen |
| Browser fallback policy | **COMPLETE** |
| Yes / no confirmation | **COMPLETE** (headless) |
| Ordinal references | **COMPLETE** (headless) |
| Exactly-once execution | **COMPLETE** (headless) |
| Account isolation | **COMPLETE** (headless) |
| Cross-WebView shared state | **NOT STARTED** |
| Headless deterministic suite | **COMPLETE** |
| Safe live-model evaluation | **NOT STARTED** |
| Physical smoke test | **NOT STARTED** |

## Conversation state

Consolidated into the existing `features/conversation/conversationContext.ts`
rather than adding a second store beside it. It was already scoped to
`(accountId, conversationId)` and already discards the whole ledger when either
changes — that is the isolation guarantee, and duplicating state next to it
would have created two answers to "what is the conversation about?".

Added: `resultSets`, `pendingAction`, `recommendationHistory`.

Expiry is enforced **on read**, not by a timer. A timer that has not fired yet
would let a stale offer through, and this is the gate that decides whether
something opens on someone's screen.

## Result sets

`rememberResultSet` stores what the user was shown, in the order they saw it,
with a stable id per item and enough data to act on it — so "the second one"
resolves against the actual list instead of searching again and hoping the
ordering repeats. 30-minute TTL.

## Pending actions

Every offer the assistant makes is recorded with its resolved capability and
arguments, the result item it points at, the wording the user saw, the turn, and
a 5-minute TTL. One at a time: two live questions make "yes" ambiguous, and an
ambiguous "yes" must ask rather than guess.

`resolvePendingAction` refuses any transition out of a terminal state. That is
the exactly-once guarantee — a replayed confirmation finds the action already
`executed` and is turned away rather than running a second time.

## Confirmation: deterministic reading, model execution

`features/conversation/confirmationIntent.ts` classifies the follow-up and
resolves which action is on the table. **It executes nothing.** A regex that
opened a browser on "yes" would be hidden keyword execution — invisible to the
user, with no validation between the word and the side effect.

The engine's `runFollowUpTurn` then:

1. resolves the authorised action;
2. claims it (`accepted`) — a replay is refused here;
3. gives the model *only* that capability and tells it the arguments;
4. lets the model make the tool call;
5. marks `executed` only if a tool actually ran.

| Input | Behaviour |
| --- | --- |
| yes / yep / sure / go ahead / do it / open it | continue the exact pending action, once |
| no / nope / not now / never mind | mark declined, execute nothing |
| the first/second/third/last one | open that ordinal from the stored set |
| yes, nothing pending | "What would you like me to continue with?" — zero side effects |
| yes, offer expired | offer to look it up again — zero side effects |
| yes, replayed | refused; total side effects stays at one |
| yes, different account | nothing to continue |

## Connected YouTube

**Audit first.** "YouTube connected" meant one thing: `secure_storage_has(
"integration.youtube")` returned true. There was **no YouTube API code anywhere
in the repository** — no search, no channel lookup, no video fetch, no token
refresh, no scope check, no validation. Credential presence, and nothing read
it. Every YouTube request therefore opened a browser search, which is why the
assistant could only ever say the results were open.

`features/capabilities/youtubeAdapter.ts` now reads the stored Data API key and
calls YouTube Data API v3. New capabilities:

- `youtube.search` — read-only, returns a structured ResultSet, no browser
- `youtube.list_channel_videos` — newest uploads, newest first
- `youtube.open_result` — **reversible**, opens one already-shown result by id

Watch and channel URLs are built from ids YouTube returned, never from model
text, and still pass through the native URL validator.

**Failure is reported as failure.** A connected integration that errors does not
quietly become a browser search dressed up as success — that is precisely how
"connected" stopped meaning anything.

`web.search` no longer claims YouTube phrasing; its examples are explicitly
browser-shaped, and its description tells the model to prefer `youtube.search`.

## Recommendations

Bound to real result items, varied, and self-limiting: the same recommendation
is offered at most twice and then stops. A channel result offers "See the newest
uploads" rather than "open the first one", because opening a channel page is not
what the question was about.

## Headless suite

`npm run test:conversation-orchestrator` — 45 assertions across 13 scenarios,
driving the real ledger, resolver, plan builder and registry. Side effects are
recorded, never performed: no browser, no files, no account.

The suite asserts, among others, that every action it executed was a recorded
YouTube open and never a browser search.

## Not done

- **Cross-WebView state.** The ledger is module memory in one WebView. Voice and
  text do **not** share it. Doing this properly means a Rust-owned store, which
  is a larger change than this round.
- **Live-model evaluation harness** (`eval:chat-live`).
- **Physical smoke test**, including a live YouTube key.


---

# Part 2 — credential safety and live-model evaluation

## Incident: an API key was printed

During the credential audit a `ConvertFrom-Json` failure echoed the credential
blob in its own error message, and a live YouTube Data API key was printed to a
terminal. The user was told to rotate it. The old key is treated as revoked and
is never read again.

**Root cause, and why it was not a one-off.** Parsers embed their input in the
exceptions they throw. Node does the same thing:

```
JSON.parse('AIza…')
  → SyntaxError: Unexpected token 'A', "AIza…" is not valid JSON
```

The adapter had exactly this shape — `JSON.parse` in a `try`, and a `catch` that
**returned the raw blob as the key**, which would then have been interpolated
into a request URL. One bad stored record away from the same leak, in-product.

## COMPLETE — secret-safe credential handling

`features/capabilities/credentialParse.ts`:

- values live in a closure, unreachable by `JSON.stringify`, spread, or
  `console.log(handle)`;
- a parse failure never propagates the parser's message and never returns the
  raw blob — a blob that is not a JSON object yields **no value**;
- `describe()` reports field *names* and shape only;
- `redactSecrets()` guards any text on its way out, including URLs with `key=`
  and Authorization headers.

`check-youtube-results` proves a fake key cannot be observed through stdout,
exception text, stack, serialized objects, or a naive log statement, across six
malformed blob shapes.

## COMPLETE — credential audit (before rotation)

| | |
| --- | --- |
| Stored as | `{"apiKey": …}`, single field |
| Type | Google Data API v3 **API key**, not OAuth |
| Refresh token | None; not applicable |
| Expiry | None; revoked or restricted instead |
| Account identity | **None** — a key identifies a project, not a user |
| Scopes | N/A; public read endpoints only |
| Validation endpoint | None existed; "connected" was credential presence |
| Adapter expectation | Matches (`apiKey` first) |

Classification at the time: **USABLE_FOR_DATA_API** — proven by live 200s for
channel search, video search and channel listing, with ordering preserved.

**Capability boundary:** because this is a project key, "my subscriptions",
"my liked videos" and "my uploads" are impossible. Those need OAuth.

## COMPLETE — structured result integrity

34 fixture assertions: stable set/item ids, preserved order, 1-based ordinals,
titles/types/channels/source ids, absent-vs-empty thumbnails, HTTPS + approved
host, each URL derived from its own source id, expiry, account and conversation
scope. Rejects `javascript:`, plain http, `evil.example.com`, and the
`youtube.com.evil.example` lookalike.

**Deduplication was asserted before it existed** — the test was written for
behaviour the code did not have. Now deterministic: first occurrence wins,
ordinals renumbered.

## COMPLETE — safe live-model evaluation

`npm run eval:chat-live -- --safe` — 40 scenarios against the model production
actually routes to (`deepseek-v4-flash`), using the production registry,
retrieval, ledger, result sets and pending actions. Side effects recorded, never
performed. Refuses to run without `--safe`; `--youtube-live-readonly` is hard-
disabled until the key is rotated.

Final run:

| Group | Result |
| --- | --- |
| connected-search | 9/10 |
| browser-intent | 5/5 |
| connection | 5/5 |
| confirm / decline / ordinal | 15/15 |
| no-context / expired | 5/5 |
| **Confirmation resolution** | **100%** (need 95%) |
| **Model tool selection** | **95%** (need 90%) |

All five invariants clean: no duplicate executions, no browser action outside
browser intent, no real API call, no expired execution, no action without
context.

### Defects the evaluation found, and the repairs

1. **The harness lied about its own coverage.** With no provider key it skipped
   20 scenarios and printed "model tool selection 100%" — an empty list scoring
   100. Now prints `NOT MEASURED`, names the skip count, and fails the run.
2. **Browser intent lost to the connected adapter.** "Search YouTube in my
   browser" and "take me to YouTube results" both chose `youtube.search`.
   Descriptions now separate them explicitly.
3. **`youtube.com` was one token.** The router's `normalize` only strips
   *trailing* punctuation, so "open youtube.com" matched neither the `youtube`
   keyword nor `com`, and retrieval offered no web tool at all. `tokens()` now
   also emits the parts of a dotted token — which fixes "report.pdf" too.
4. **Provider markup could reach the user.** DeepSeek sometimes emits a tool
   call as text (`<｜｜DSML｜｜tool_calls>`). `sanitizeUserFacingText` now strips
   it.

## FAILED — 1 of 40

"What did MrBeast upload recently?" — the model selects `youtube.search`
correctly but the provider serialises it as text markup instead of a
`tool_calls` field, so no tool runs. Reproducible on this phrasing. The
user-visible symptom is mitigated (markup stripped); the turn still does
nothing useful. This is a provider serialisation bug, not a selection error.
Recovering it would mean parsing undocumented provider markup as a fallback
tool call — deliberately not done.

## BLOCKED

- **Replacement credential verification.** Waiting on rotation.
- **Physical smoke tests.** Gated on the above, per the required ordering.

## NOT STARTED

Cross-WebView Rust-owned state. Voice and text still do not share a ledger.
