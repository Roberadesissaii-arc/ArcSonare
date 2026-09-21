/**
 * ArcSonare VS Code bridge.
 *
 * Serves one named pipe per workspace window so ArcSonare can read what is
 * being edited and run *configured* tasks. Three rules shape everything here:
 *
 *  1. **No arbitrary execution.** `run_task` takes the name of a task already
 *     declared in this workspace's `tasks.json` and nothing else. There is no
 *     command string on the wire, so a model that invents one has nothing to
 *     invent it into.
 *  2. **Content is opt-in.** Selected text and terminal/task output are off by
 *     default and gated by workspace settings the user controls here, in their
 *     editor — not only in ArcSonare.
 *  3. **The workspace is checked on every request.** The pipe name is derived
 *     from the folder, but names can collide after slugging, so the request
 *     carries the workspace it believes it is addressing and a mismatch is
 *     refused rather than served.
 */
const vscode = require("vscode");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PIPE_PREFIX = "\\\\.\\pipe\\arcsonare-vscode-";

/** Must match `pipe_name` in `src-tauri/src/watch/vscode_bridge.rs`. */
function pipeNameFor(workspace) {
  const slug = String(workspace)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${PIPE_PREFIX}${slug}`;
}

function stateDir() {
  const base =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "ArcSonare");
}

function tokenPath() {
  return path.join(stateDir(), "vscode-bridge.token");
}

/**
 * Where a window records whether it is serving, and why not when it is not.
 *
 * Without this, "the extension is installed but this window is not serving" is
 * all ArcSonare can say, and the user has no way to find out whether the cause
 * is a name collision, a disabled setting, or an activation that never ran. The
 * file is per workspace, so a window that never activates simply has none —
 * which is itself the answer.
 */
function statusPath(workspace) {
  const slug = String(workspace)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+|-+$/g, "");
  return path.join(stateDir(), `vscode-bridge-${slug}.status.json`);
}

function writeStatus(workspace, status) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(
      statusPath(workspace),
      JSON.stringify(
        { workspace, pid: process.pid, at: new Date().toISOString(), ...status },
        null,
        2,
      ),
    );
  } catch {
    // Diagnostics must never break the bridge.
  }
}

/**
 * Read the shared secret, creating one if this is the first window.
 *
 * Written with mode 0600 so another account on this machine cannot read it and
 * drive this user's editor.
 */
function ensureToken() {
  const file = tokenPath();
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    // Not created yet.
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

/** The folder name ArcSonare will address this window by. */
function workspaceIdentity() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].name;
  return vscode.workspace.name || "untitled";
}

/** Recent task and debug output, kept in memory and never written to disk. */
const recentOutput = [];
const MAX_OUTPUT_LINES = 200;

function recordOutput(kind, text) {
  const line = `[${new Date().toISOString()}] ${kind}: ${text}`;
  recentOutput.push(line);
  while (recentOutput.length > MAX_OUTPUT_LINES) recentOutput.shift();
}

function config() {
  return vscode.workspace.getConfiguration("arcsonare.bridge");
}

async function collectContext() {
  const editor = vscode.window.activeTextEditor;
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));

  const diagnostics = [];
  for (const [uri, list] of vscode.languages.getDiagnostics()) {
    for (const d of list) {
      if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
      diagnostics.push({
        file: vscode.workspace.asRelativePath(uri),
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        severity:
          d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning",
        message: d.message,
        source: d.source || null,
      });
    }
  }
  diagnostics.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );

  const tasks = (await vscode.tasks.fetchTasks()).map((t) => ({
    name: t.name,
    source: t.source,
    group: t.group ? String(t.group.id || t.group) : null,
  }));

  const gitApi = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI?.(1);
  const repo = gitApi?.repositories?.[0];

  const shareSelection = config().get("shareSelectedText", false);
  const shareOutput = config().get("shareTerminalOutput", false);

  return {
    workspaceFolders: folders,
    activeFile: editor
      ? {
          path: vscode.workspace.asRelativePath(editor.document.uri),
          absolutePath: editor.document.uri.fsPath,
          language: editor.document.languageId,
          lineCount: editor.document.lineCount,
          cursorLine: editor.selection.active.line + 1,
          isDirty: editor.document.isDirty,
        }
      : null,
    // Present only when the user turned it on, in their own editor.
    selectedText:
      shareSelection && editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).slice(0, 4000)
        : null,
    selectionAvailable: Boolean(editor && !editor.selection.isEmpty),
    diagnostics: diagnostics.slice(0, 50),
    diagnosticCounts: {
      errors: diagnostics.filter((d) => d.severity === "error").length,
      warnings: diagnostics.filter((d) => d.severity === "warning").length,
    },
    tasks,
    terminals: vscode.window.terminals.map((t) => t.name),
    recentOutput: shareOutput ? recentOutput.slice(-40) : null,
    outputAvailable: recentOutput.length > 0,
    debugSession: vscode.debug.activeDebugSession
      ? { name: vscode.debug.activeDebugSession.name, type: vscode.debug.activeDebugSession.type }
      : null,
    git: repo
      ? {
          branch: repo.state.HEAD?.name || null,
          changes: repo.state.workingTreeChanges.length,
        }
      : null,
    permissions: {
      selectedText: shareSelection,
      terminalOutput: shareOutput,
    },
  };
}

async function runConfiguredTask(name) {
  const tasks = await vscode.tasks.fetchTasks();
  const task = tasks.find((t) => t.name === name);
  if (!task) {
    const available = tasks.map((t) => t.name);
    return {
      ok: false,
      error: `No task named "${name}" is configured in this workspace.`,
      data: { availableTasks: available },
    };
  }
  const execution = await vscode.tasks.executeTask(task);
  recordOutput("task-started", task.name);
  return {
    ok: true,
    data: { started: task.name, executionId: String(execution.task.name) },
  };
}

async function startDebugProfile(name) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return { ok: false, error: "This window has no workspace folder to debug." };
  }
  const configs =
    vscode.workspace.getConfiguration("launch", folder.uri).get("configurations") ||
    [];
  const chosen = name
    ? configs.find((c) => c.name === name)
    : configs[0];
  if (!chosen) {
    return {
      ok: false,
      error: name
        ? `No debug configuration named "${name}".`
        : "This workspace has no debug configurations.",
      data: { availableConfigurations: configs.map((c) => c.name) },
    };
  }
  const started = await vscode.debug.startDebugging(folder, chosen.name);
  recordOutput("debug-started", chosen.name);
  return { ok: started, data: { configuration: chosen.name } };
}

async function handle(message) {
  const identity = workspaceIdentity();
  if (message.workspace !== identity) {
    // A slug collision, or a request meant for another window. Refusing is the
    // whole reason the workspace travels on the request.
    return {
      ok: false,
      error: `This window serves "${identity}", not "${message.workspace}".`,
    };
  }

  switch (message.command) {
    case "get_context":
      return { ok: true, data: await collectContext() };
    case "list_tasks": {
      const tasks = await vscode.tasks.fetchTasks();
      return { ok: true, data: { tasks: tasks.map((t) => t.name) } };
    }
    case "run_task":
      if (!message.argument) {
        return { ok: false, error: "run_task needs the name of a configured task." };
      }
      return runConfiguredTask(message.argument);
    case "stop_task":
      vscode.tasks.taskExecutions.forEach((e) => e.terminate());
      recordOutput("task-stopped", "all");
      return { ok: true, data: { stopped: true } };
    case "start_debug":
      return startDebugProfile(message.argument);
    case "focus_file": {
      if (!message.argument) {
        return { ok: false, error: "focus_file needs a path." };
      }
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return { ok: false, error: "No workspace folder." };
      const target = vscode.Uri.joinPath(folder.uri, message.argument);
      // Confined to the workspace: a path that escapes it is refused rather
      // than opened, so the bridge cannot be used to read arbitrary files.
      if (!target.fsPath.startsWith(folder.uri.fsPath)) {
        return { ok: false, error: "That path is outside this workspace." };
      }
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc);
      return { ok: true, data: { opened: message.argument } };
    }
    case "save_file": {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return { ok: false, error: "No active editor to save." };
      const saved = await editor.document.save();
      return { ok: saved, data: { saved: editor.document.fileName } };
    }
    default:
      return { ok: false, error: `Unknown command "${message.command}".` };
  }
}

let server = null;
let statusBar = null;

function serve(context) {
  const identity = workspaceIdentity();
  if (!config().get("enabled", true)) {
    writeStatus(identity, {
      serving: false,
      reason: "arcsonare.bridge.enabled is off for this workspace.",
    });
    return;
  }
  const token = ensureToken();
  const name = pipeNameFor(identity);
  writeStatus(identity, { serving: false, reason: "starting", pipe: name });

  server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let response;
        try {
          const message = JSON.parse(line);
          // Constant-time compare so a wrong token cannot be discovered by
          // timing the rejection.
          const supplied = Buffer.from(String(message.token || ""));
          const expected = Buffer.from(token);
          const authenticated =
            supplied.length === expected.length &&
            crypto.timingSafeEqual(supplied, expected);
          response = authenticated
            ? await handle(message)
            : { ok: false, error: "Unauthenticated." };
        } catch (err) {
          response = { ok: false, error: String(err && err.message) };
        }
        socket.write(`${JSON.stringify(response)}\n`);
      }
    });
    socket.on("error", () => socket.destroy());
  });

  server.on("error", (err) => {
    // Another window already serves this workspace name. That is expected when
    // the same folder is open twice; this window simply does not serve.
    console.warn(`[ArcSonare] bridge not started: ${err.message}`);
    writeStatus(identity, {
      serving: false,
      reason: `the pipe could not be opened: ${err.message}`,
      pipe: name,
    });
    if (statusBar) statusBar.text = "$(circle-slash) ArcSonare";
  });

  server.listen(name, () => {
    writeStatus(identity, { serving: true, pipe: name });
    if (statusBar) {
      statusBar.text = "$(broadcast) ArcSonare";
      statusBar.tooltip = `Serving "${identity}" to ArcSonare`;
      statusBar.show();
    }
  });

  context.subscriptions.push({ dispose: () => server && server.close() });
}

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    0,
  );
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess((e) => {
      recordOutput(
        "task-ended",
        `${e.execution.task.name} exited with code ${e.exitCode}`,
      );
    }),
    vscode.debug.onDidTerminateDebugSession((s) => {
      recordOutput("debug-ended", s.name);
    }),
    vscode.commands.registerCommand("arcsonare.showBridgeStatus", () => {
      vscode.window.showInformationMessage(
        server && server.listening
          ? `ArcSonare bridge: serving "${workspaceIdentity()}".`
          : "ArcSonare bridge: not serving this window.",
      );
    }),
    vscode.commands.registerCommand("arcsonare.stopBridge", () => {
      if (server) server.close();
      if (statusBar) statusBar.hide();
      vscode.window.showInformationMessage("ArcSonare bridge stopped.");
    }),
  );

  serve(context);
}

function deactivate() {
  if (server) server.close();
  try {
    fs.unlinkSync(statusPath(workspaceIdentity()));
  } catch {
    // Already gone.
  }
}

module.exports = { activate, deactivate, pipeNameFor };
