# ArcSonare VS Code bridge

Lets ArcSonare answer "what file am I editing?", "what errors are here?" and
"run this code" against **the workspace you chose to watch**, rather than
guessing from the window title.

## What it shares

Always, once installed and enabled:

- workspace folder names and paths
- the active file's workspace-relative path, language and line count
- diagnostics (errors and warnings) reported by your language servers
- the names of configured tasks, open terminals and the active debug session
- the current Git branch and how many files are changed

Only when you turn it on, in this extension's settings:

- `arcsonare.bridge.shareSelectedText` — the current selection. **Off by
  default**: a selection is source code.
- `arcsonare.bridge.shareTerminalOutput` — recent task and debug output. **Off
  by default**: build output routinely contains paths, machine names and tokens.

ArcSonare's own per-application privacy settings apply on top of these. Both
must allow a class of content before it is read; either one can withhold it.

## What it cannot do

- **Run arbitrary commands.** `run_task` takes the *name* of a task already
  declared in this workspace's `tasks.json`. No command string crosses the pipe,
  so there is nothing for a model to inject one into.
- **Read outside the workspace.** `focus_file` refuses any path that escapes the
  workspace folder.
- **Reach the network.** There is no listener on any port. The transport is a
  Windows named pipe, which is not routable.

## How the connection is secured

- One pipe per workspace window: `\\.\pipe\arcsonare-vscode-<workspace-slug>`.
- A 32-byte shared secret at `%LOCALAPPDATA%\ArcSonare\vscode-bridge.token`,
  created with mode 0600 so no other account on the machine can read it. Every
  request carries it and is compared in constant time.
- Every request also carries the workspace it believes it is addressing. A
  window that serves a different folder refuses instead of answering — two
  folders can slug to the same pipe name, and serving the wrong one is exactly
  the "ran the task in the other workspace" failure this design prevents.

## Install

```bash
code --install-extension integrations/vscode-arcsonare
```

Or, during development, copy the folder into `%USERPROFILE%\.vscode\extensions\`
and reload the window.

Check it is running with **ArcSonare: Show bridge status** in the command
palette, or look for the broadcast icon in the status bar.

## Workspace trust

The bridge can run this workspace's tasks, so it declares that it needs a
**trusted** workspace. VS Code disables it entirely in an untrusted one — no
activation, no pipe, no status file.

That is deliberate, and it is the most common reason a window is not serving:
an untrusted window looks exactly like one where the extension was never
installed. Click **Trust** in that window (or use *Workspaces: Manage Workspace
Trust*) and reload. ArcSonare names this as the likely cause rather than
reporting a bare "not serving".

Each serving window writes
`%LOCALAPPDATA%\ArcSonare\vscode-bridge-<workspace>.status.json` on activation.
A missing file means the extension never activated in that window; a file with
`"serving": false` carries the reason.

## When it is not installed

ArcSonare says so. The VS Code adapter reports `METADATA_ONLY` and answers only
from window metadata — which file the title names, and nothing else. It does not
infer diagnostics, tasks or terminal output from a title.
