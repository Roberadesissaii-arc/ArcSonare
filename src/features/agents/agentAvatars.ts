import novaAvatar from "../../assets/agents/abstract-project-manager-v2.jpg";
import atlasAvatar from "../../assets/agents/abstract-research-analyst-v2.jpg";
import lyraAvatar from "../../assets/agents/abstract-content-creator-v2.jpg";
import celesteAvatar from "../../assets/agents/abstract-executive-assistant-v2.jpg";
import echoAvatar from "../../assets/agents/abstract-email-assistant-v2.jpg";
import miraAvatar from "../../assets/agents/abstract-meeting-assistant-v2.jpg";
import rowanAvatar from "../../assets/agents/abstract-file-organizer-v2.jpg";
import soraAvatar from "../../assets/agents/abstract-screen-analyst-v2.jpg";
import pulseAvatar from "../../assets/agents/abstract-data-analyst-v2.jpg";
import fluxAvatar from "../../assets/agents/abstract-workflow-automator-v2.jpg";

export const AGENT_AVATARS = {
  nova: novaAvatar,
  atlas: atlasAvatar,
  lyra: lyraAvatar,
  celeste: celesteAvatar,
  echo: echoAvatar,
  mira: miraAvatar,
  rowan: rowanAvatar,
  sora: soraAvatar,
  pulse: pulseAvatar,
  flux: fluxAvatar,
} as const;

export type AgentAvatarId = keyof typeof AGENT_AVATARS;

export function agentAvatarSrc(avatarId?: string | null): string | undefined {
  if (!avatarId || !(avatarId in AGENT_AVATARS)) return undefined;
  return AGENT_AVATARS[avatarId as AgentAvatarId];
}

export function defaultAvatarIdForAgent(id: string): AgentAvatarId | null {
  if (id === "project-manager") return "nova";
  if (id === "research-analyst") return "atlas";
  if (id === "content-creator") return "lyra";
  if (id === "executive-assistant") return "celeste";
  if (id === "email-assistant") return "echo";
  if (id === "meeting-assistant") return "mira";
  if (id === "file-organizer") return "rowan";
  if (id === "screen-analyst") return "sora";
  if (id === "data-analyst") return "pulse";
  if (id === "workflow-automator") return "flux";
  return null;
}
