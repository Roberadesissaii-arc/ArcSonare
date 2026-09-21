import { invoke } from "@tauri-apps/api/core";
import type { AgentConfig } from "../features/agents/agentStore";

export type LocalAgentRow = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  configurationJson: string;
  status: string;
  runtimeType: string;
  createdAt: string;
  updatedAt: string;
};

export function rowToAgent(
  row: LocalAgentRow,
  normalize: (raw: Partial<AgentConfig> & { id: string }) => AgentConfig,
): AgentConfig {
  try {
    const raw = JSON.parse(row.configurationJson) as unknown;
    if (raw && typeof raw === "object" && "id" in (raw as object)) {
      return normalize({
        ...(raw as Partial<AgentConfig>),
        id: row.id,
        demo: false,
      });
    }
  } catch {
    // fall through
  }
  return normalize({
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description ?? "",
    enabled: row.status === "active",
    runtimeType: (row.runtimeType as AgentConfig["runtimeType"]) || "manual",
    demo: false,
  });
}

export async function listAgentsFromDb(
  normalize: (raw: Partial<AgentConfig> & { id: string }) => AgentConfig,
): Promise<AgentConfig[]> {
  const rows = await invoke<LocalAgentRow[] | null>("agents_list_local");
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((r) => r && typeof r.id === "string" && r.id.length > 0)
    .map((r) => {
      try {
        return rowToAgent(r, normalize);
      } catch (err) {
        console.error("[ArcSonare] bad agent row", r?.id, err);
        return normalize({
          id: r.id,
          name: r.name || r.id,
          role: r.role || "Specialist",
          description: r.description ?? "",
          demo: false,
        });
      }
    });
}

export async function upsertAgentToDb(agent: AgentConfig): Promise<void> {
  await invoke("agents_upsert_local", { agent: { ...agent, demo: false } });
}

export async function softDeleteAgentInDb(agentId: string): Promise<void> {
  await invoke("agents_soft_delete_local", { agentId });
}
