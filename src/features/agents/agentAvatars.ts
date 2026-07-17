import novaAvatar from "../../assets/agents/nova-project-manager.webp";
import atlasAvatar from "../../assets/agents/atlas-research-analyst.webp";
import lyraAvatar from "../../assets/agents/lyra-content-creator.webp";
import celesteAvatar from "../../assets/agents/celeste-executive-assistant.webp";
import echoAvatar from "../../assets/agents/echo-email-assistant.webp";
import miraAvatar from "../../assets/agents/mira-meeting-assistant.webp";
import rowanAvatar from "../../assets/agents/rowan-file-organizer.webp";
import soraAvatar from "../../assets/agents/sora-screen-analyst.webp";

export const AGENT_AVATARS = {
  nova: novaAvatar,
  atlas: atlasAvatar,
  lyra: lyraAvatar,
  celeste: celesteAvatar,
  echo: echoAvatar,
  mira: miraAvatar,
  rowan: rowanAvatar,
  sora: soraAvatar,
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
  return null;
}
