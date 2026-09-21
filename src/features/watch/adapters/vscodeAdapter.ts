/**
 * VS Code adapter.
 *
 * Backed by the ArcSonare VS Code extension over a per-workspace named pipe
 * (`integrations/vscode-arcsonare`). Without it, this adapter is
 * `METADATA_ONLY` and says so — it will not infer diagnostics, tasks or
 * terminal output from a window title, because "main.rs — proj — Visual Studio
 * Code" says which file is focused and nothing whatsoever about whether it
 * compiles.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../../capabilities/capabilityTypes";
import type {
  AdapterCapabilityReport,
  AdapterSnapshot,
  AdapterValidation,
  ApplicationAdapter,
  ContextField,
} from "./adapterTypes";

interface BridgeContext {
  workspaceFolders: Array<{ name: string; path: string }>;
  activeFile: {
    path: string;
    language: string;
    lineCount: number;
    cursorLine: number;
    isDirty: boolean;
  } | null;
  selectedText: string | null;
  selectionAvailable: boolean;
  diagnostics: Array<{
    file: string;
    line: number;
    severity: "error" | "warning";
    message: string;
  }>;
  diagnosticCounts: { errors: number; warnings: number };
  tasks: Array<{ name: string }>;
  terminals: string[];
  recentOutput: string[] | null;
  outputAvailable: boolean;
  debugSession: { name: string; type: string } | null;
  git: { branch: string | null; changes: number } | null;
  permissions: { selectedText: boolean; terminalOutput: boolean };
}

const BRIDGE_FIELDS: ContextField[] = [
  {
    id: "workspace",
    label: "Workspace folders",
    source: "application-bridge",
    privacyClass: "document-identity",
    implemented: true,
  },
  {
    id: "activeFile",
    label: "Active file, language and cursor line",
    source: "application-bridge",
    privacyClass: "document-identity",
    implemented: true,
  },
  {
    id: "diagnostics",
    label: "Errors and warnings from language servers",
    source: "application-bridge",
    privacyClass: "document-identity",
    implemented: true,
  },
  {
    id: "tasks",
    label: "Configured tasks",
    source: "application-bridge",
    privacyClass: "app-identity",
    implemented: true,
  },
  {
    id: "git",
    label: "Git branch and change count",
    source: "application-bridge",
    privacyClass: "document-identity",
    implemented: true,
  },
  {
    id: "selectedText",
    label: "The current selection",
    source: "application-bridge",
    privacyClass: "source-code",
    implemented: true,
  },
  {
    id: "terminalOutput",
    label: "Recent task and debug output",
    source: "application-bridge",
    privacyClass: "terminal-output",
    implemented: true,
  },
];

/** The only thing readable without the extension. */
const METADATA_FIELDS: ContextField[] = [
  {
    id: "windowTitle",
    label: "The window title (which file and folder it names)",
    source: "window-metadata",
    privacyClass: "window-title",
    implemented: true,
  },
];

export const vscodeAdapter: ApplicationAdapter = {
  id: "vscode-bridge",
  applicationIds: ["vscode", "cursor"],
  implementation: "PARTIAL",

  discover(instance) {
    return instance.appCatalogId === "vscode" || instance.appCatalogId === "cursor";
  },

  getCapabilities(_instance): AdapterCapabilityReport {
    return {
      adapterId: "vscode-bridge",
      implementation: "PARTIAL",
      readable: [...METADATA_FIELDS, ...BRIDGE_FIELDS],
      unreadable: [],
      actions: [
        {
          capabilityId: "vscode.get_context",
          label: "Read the editor state",
          source: "application-bridge",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "vscode.get_diagnostics",
          label: "Read errors and warnings",
          source: "application-bridge",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "vscode.list_tasks",
          label: "List configured tasks",
          source: "application-bridge",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "vscode.run_task",
          label: "Run a configured task",
          source: "application-bridge",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "vscode.start_debug",
          label: "Start a configured debug profile",
          source: "application-bridge",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "vscode.stop_task",
          label: "Stop running tasks",
          source: "application-bridge",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "applications.focus_watched",
          label: "Bring this workspace to the front",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
      ],
      unsupported: [
        {
          label: "Run an arbitrary shell command",
          reason:
            "Only tasks already declared in this workspace's tasks.json can be run. No command string crosses the bridge.",
        },
        {
          label: "Edit files",
          reason:
            "The bridge reads and runs; file changes go through ArcSonare's own filesystem capabilities, which have their own confirmation.",
        },
        {
          label: "Read files outside the workspace",
          reason: "The extension refuses any path that escapes the workspace folder.",
        },
      ],
      requiredPermissions: ["document-identity", "source-code", "terminal-output"],
    };
  },

  async getSnapshot(instance, request): Promise<AdapterSnapshot> {
    const capturedAt = new Date().toISOString();
    const policy = request.application.privacyPolicy;
    const limitations: string[] = [];

    const result = await runCapability("vscode.get_context", {
      instance_key: instance.instanceKey,
    });

    // No bridge: window metadata only, stated as such.
    if (!result || result.status !== "success") {
      const reason =
        result?.status === "unsupported"
          ? "The ArcSonare VS Code extension is not installed."
          : (result?.summary ?? "The VS Code bridge is not reachable.");
      return {
        adapterId: "vscode-bridge",
        instanceKey: instance.instanceKey,
        capturedAt,
        facts: {
          workspace: instance.workspaceIdentity ?? null,
          windowTitle: policy.windowTitle ? instance.windowTitle : undefined,
        },
        sources: { workspace: "window-metadata", windowTitle: "window-metadata" },
        summary: instance.workspaceIdentity
          ? `VS Code, workspace "${instance.workspaceIdentity}". ${reason}`
          : `VS Code is open. ${reason}`,
        limitations: [
          reason,
          "Diagnostics, tasks and terminal output cannot be read without the extension.",
        ],
      };
    }

    const context = result.data as BridgeContext;
    const facts: Record<string, unknown> = {
      workspace: context.workspaceFolders.map((f) => f.name),
      gitBranch: context.git?.branch ?? null,
      gitChanges: context.git?.changes ?? null,
      tasks: context.tasks.map((t) => t.name),
      terminals: context.terminals,
      debugSession: context.debugSession?.name ?? null,
    };

    if (policy.documentIdentity) {
      facts.activeFile = context.activeFile;
      facts.diagnosticCounts = context.diagnosticCounts;
      facts.diagnostics = context.diagnostics.slice(0, 20);
    } else {
      limitations.push(
        "File paths and diagnostics are hidden by this application's privacy settings.",
      );
    }

    // Two gates on content, and both must pass: the user's ArcSonare policy and
    // the setting they control inside their own editor.
    if (policy.sourceCode && context.permissions.selectedText) {
      facts.selectedText = context.selectedText;
    } else if (context.selectionAvailable) {
      limitations.push(
        policy.sourceCode
          ? "The selection is not shared — turn on arcsonare.bridge.shareSelectedText in VS Code."
          : "The selection is not shared — source-code sharing is off for this application.",
      );
    }

    if (policy.terminalOutput && context.permissions.terminalOutput) {
      facts.recentOutput = context.recentOutput;
    } else if (context.outputAvailable) {
      limitations.push(
        policy.terminalOutput
          ? "Task output is not shared — turn on arcsonare.bridge.shareTerminalOutput in VS Code."
          : "Task output is not shared — terminal-output sharing is off for this application.",
      );
    }

    const workspace = context.workspaceFolders[0]?.name ?? "workspace";
    const file = policy.documentIdentity ? context.activeFile?.path : null;
    const errors = context.diagnosticCounts.errors;
    const summary = [
      `VS Code "${workspace}"`,
      file ? `editing ${file}` : null,
      policy.documentIdentity
        ? `${errors} error${errors === 1 ? "" : "s"}, ${context.diagnosticCounts.warnings} warning${context.diagnosticCounts.warnings === 1 ? "" : "s"}`
        : null,
      context.git?.branch ? `on ${context.git.branch}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return {
      adapterId: "vscode-bridge",
      instanceKey: instance.instanceKey,
      capturedAt,
      facts,
      sources: {
        workspace: "application-bridge",
        activeFile: "application-bridge",
        diagnostics: "application-bridge",
        tasks: "application-bridge",
        selectedText: "application-bridge",
        recentOutput: "application-bridge",
      },
      summary,
      limitations,
    };
  },

  async validate(instance): Promise<AdapterValidation> {
    const result = await runCapability("vscode.bridge_status", {
      instance_key: instance.instanceKey,
    });
    if (!result || result.status !== "success") {
      return {
        ok: false,
        health: "unavailable",
        message: result?.summary ?? "The bridge status could not be read.",
      };
    }
    const health = (result.data as { health?: string })?.health;
    return {
      ok: health === "healthy",
      health: (health as AdapterValidation["health"]) ?? "unavailable",
      message: result.summary,
    };
  },
};

async function runCapability(
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<ToolResult | null> {
  try {
    return await invoke<ToolResult>("capability_execute", {
      capabilityId,
      args,
      runId: null,
      userRequestSummary: "watched application context",
      confirmationToken: null,
    });
  } catch (err) {
    console.error(`[ArcSonare] ${capabilityId} failed:`, err);
    return null;
  }
}
