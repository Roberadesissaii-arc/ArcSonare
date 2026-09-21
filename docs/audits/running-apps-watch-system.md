# Running Apps / Watch system

What "Watch" meant before, what it means now, and what is still not true.

## What it was

A `Set<string>` of curated-catalog ids in `localStorage`, under
`arcsonare.dashboard.contextApps.active.v1`. Everything wrong with the feature
followed from that one representation:

| Symptom | Cause |
| --- | --- |
| Voice and the Dashboard disagreed about what was watched | `sonare-overlay` is its own WebView2 heap. Module state is not shared, and `buildRealtimeInstructions` had no desktop parameter at all — so even one heap would not have fixed it. |
| Signing out left the previous account's watches | Browser storage is keyed by origin, not by account. |
| Closing an application silently un-watched it | `syncContextActivations` deleted every id absent from the running set, on an 8-second poll. |
| Two VS Code workspaces were one row | Detection keyed a `Map` on the *catalog id* and `break`'d after the first matching process. |
| "What is happening in Discord?" was unanswerable | There were no application adapters. Window titles were the entire model. |
| The card showed two apps and paged by one | `VISIBLE_ROWS = 2` drove a sliding window with wheel-jacking. "Two at a time" was presented as the feature. |

Native discovery already produced pid, opaque window id, bounds, title and
process name. The frontend's `ProcessRow`/`WindowRow` interfaces declared four
fields and two fields respectively; everything else was dropped before it
reached a decision.

## What it is now

### The store is Rust-owned and account-scoped

`watched_applications`, `watched_app_instances` and `watch_sessions` live in the
per-user SQLite database (`database/migrations.rs`, schema v2). Account scoping
is structural rather than a `WHERE` clause: `DatabaseManager` opens a different
*file* per account, keyed by `sha256(user_id)`, so one account's query cannot
reach another's rows.

Closing an application moves its watch to `app-closed`. It is never deleted, and
its privacy policy and pinned instance survive a stop/re-watch.

### Instances carry real identity

`watch/instances.rs` reports, per window: pid, full executable path, opaque
window id, title, bounds, parent pid, workspace identity, and a stable
EDID-derived monitor key from `display::identity` (never a persisted `xcap`
ordinal).

`instance_key` deliberately excludes the pid and the HWND — Windows recycles
both — and, after the live run caught it, excludes anything else that changes
under the user:

- A **browser's page identity is not its key.** A Chrome window keyed
  `chrome:ws:ai-calibration-process` would have become a different instance on
  every navigation, dropping the pin and re-announcing the window as new.
- An **executable's path is not its key.** Discord installs under
  `app-1.0.9250`, so a path-derived key changed on every update.

Two VS Code workspaces in one process resolve to `vscode:ws:ws-alpha` and
`vscode:ws:ws-beta`, which is the case pid-based identity cannot express.

### Resolution asks rather than guesses

`watch/resolve.rs`: pinned → conversation-bound → only-instance → **ask**. There
is deliberately no "most recently focused" fallback. Focus is not a decision —
the user may simply have alt-tabbed — and treating it as one is how a command
lands in the wrong window.

### One gate, two surfaces

`capabilitiesForOrigin` now takes live watched applications alongside connected
connectors and withholds `watched-app` capabilities that have no running
instance. Chat, voice and the router all narrow through it. A second filter in
one surface would be a second allowlist, and two allowlists drift — which is how
voice came to advertise Gmail tools with Gmail disconnected.

`buildRealtimeInstructions` gained the `watchedApps` parameter it never had, and
both surfaces build that block through `watchContextForPrompt`.

### Consent is enforced where data is produced

`PrivacyPolicy` is per application, closed by default for message content,
source code, terminal output and screenshots, and closed for *window titles* on
messaging and mail applications — a title is frequently the message.

The check runs in Rust, in the capability, not only in the TypeScript adapter:
`capability_execute` is reachable directly, and a model that skips the adapter
must still be refused. A policy that fails to parse falls back to the **closed**
defaults.

## Adapters, and what each can honestly do

| Adapter | Source | Reads | Acts |
| --- | --- | --- | --- |
| `spotify-desktop` | Windows GSMTC | playback state, title, artist, album, available transport controls | play, pause, next, previous, focus |
| `vscode-bridge` | ArcSonare VS Code extension over a per-workspace named pipe | workspace, active file, diagnostics, tasks, terminals, debug session, Git branch; selection and task output only with two separate consents | run a *configured* task, start a configured debug profile, stop tasks, focus |
| `discord-desktop` | window title + UI Automation | server/channel from the title, unread flag, control names; message text only with consent and only when the tree exposes it | focus, prepare a message, send after one confirmation |
| `browser-window` | window metadata | page identity, site | focus, back/forward/reload |

Everything else is `METADATA_ONLY`: ArcSonare says it can see the window and not
what is inside it.

**Discord's stored credential is not used.** There is no Discord connector; the
adapter reads the running window and says so.

## What is still not true

- **The browser cannot read its address bar or tab list.** Windows exposes one
  title per window. `browser.get_page_context` returns the page *identity* and
  states the limitation; it does not claim to read the URL.
- **Discord message bodies are usually unreadable.** Electron publishes an
  accessibility tree only when accessibility support is on. On this machine the
  tree exists and yields 15 control names but no message text, and the adapter
  reports that rather than substituting a screenshot.
- **Spotify's in-app volume is not readable.** Windows exposes the system mixer
  level for the process, which is a different number.
- **The VS Code bridge needs a trusted workspace.** The extension declares
  `untrustedWorkspaces.supported: false` because it can run tasks, so VS Code
  disables it entirely in an untrusted folder — and an untrusted window is
  indistinguishable from one where the extension was never installed. Each
  serving window now writes a status file, and ArcSonare names workspace trust
  as the likely cause instead of reporting a bare "not serving".
- **No Discord message was physically sent.** The prepare/deny guards were
  exercised against the real window; delivery reaches another person and was not
  performed on a test suite's authority.

## Physical verification

Run `cargo test --lib watch::live_test -- --nocapture`. It enumerates real
windows and reports which applications it could exercise, so a pass with the
application closed is visible as a skip rather than a silent green.

Observed on this machine:

- **Spotify** — played, paused and skipped real tracks (`"Man Tegebe"` →
  `"Maal Attamittiin Dagatu"`), each verified by reading the session back, and
  the original state restored.
- **VS Code** — two workspaces, each answering with its own active file, its own
  diagnostics (`ws-alpha: editing main.ts, 1 error(s)`) and its own tasks. Each
  ran its own configured task; neither could run the other's.
- **Discord** — 15 real control names via UI Automation; title `Friends -
  Discord` correctly reported as *not naming a channel*; preparing a message
  refused because the confirmation could not name a recipient.
- **Browser** — real YouTube page title read, window focused by instance key.
