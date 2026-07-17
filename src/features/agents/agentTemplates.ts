/**
 * Agent templates: purpose, suggested tools and safe permission suggestions.
 * Selecting a template prefills the creation wizard — it never grants
 * permissions by itself (high-risk areas stay at "Ask every time").
 */
import {
  blankAgent,
  defaultPermissions,
  type AgentConfig,
  type PermissionArea,
} from "./agentStore";

export interface AgentTemplate {
  id: string;
  name: string;
  purpose: string;
  role: string;
  initials: string;
  suggestedTools: PermissionArea[];
  recommendedPermissionNote: string;
  suggestedModelRole: string;
  suggestedVoiceBehavior: string;
  objective: string;
  guidelines: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "project-manager",
    name: "Project Manager",
    purpose: "Keeps tasks, owners and deadlines aligned.",
    role: "Coordination",
    initials: "PM",
    suggestedTools: ["tasks", "calendar", "notifications"],
    recommendedPermissionNote: "Read-write tasks; calendar read-only.",
    suggestedModelRole: "Everyday assistant",
    suggestedVoiceBehavior: "Brief spoken summaries",
    objective: "Keep every task correctly prioritized, assigned and on schedule.",
    guidelines: "Prefer reordering over deleting. Flag conflicts instead of resolving them silently.",
  },
  {
    id: "research-analyst",
    name: "Research Analyst",
    purpose: "Scans sources and summarizes what changed.",
    role: "Research",
    initials: "RA",
    suggestedTools: ["tasks", "browser", "notifications"],
    recommendedPermissionNote: "Browser access asks every time.",
    suggestedModelRole: "Research",
    suggestedVoiceBehavior: "Detailed spoken briefings",
    objective: "Track configured topics and produce concise change summaries.",
    guidelines: "Cite sources. Separate facts from interpretation.",
  },
  {
    id: "content-creator",
    name: "Content Creator",
    purpose: "Drafts documents, decks and messages.",
    role: "Writing",
    initials: "CC",
    suggestedTools: ["tasks", "files"],
    recommendedPermissionNote: "File access asks every time.",
    suggestedModelRole: "Everyday assistant",
    suggestedVoiceBehavior: "Voice off by default",
    objective: "Produce drafts matching the requested tone and structure.",
    guidelines: "Always create drafts, never send or publish directly.",
  },
  {
    id: "executive-assistant",
    name: "Executive Assistant",
    purpose: "Manages schedule, reminders and daily preparation.",
    role: "Assistant",
    initials: "EA",
    suggestedTools: ["calendar", "tasks", "email", "notifications"],
    recommendedPermissionNote: "Email asks every time; calendar read-only.",
    suggestedModelRole: "Everyday assistant",
    suggestedVoiceBehavior: "Morning spoken briefing",
    objective: "Prepare each day: schedule, deadlines, follow-ups.",
    guidelines: "Never reschedule meetings without confirmation.",
  },
  {
    id: "email-assistant",
    name: "Email Assistant",
    purpose: "Triages the inbox and drafts replies.",
    role: "Communication",
    initials: "EM",
    suggestedTools: ["email", "tasks", "notifications"],
    recommendedPermissionNote: "Sending always asks; reading asks every time.",
    suggestedModelRole: "Fast commands",
    suggestedVoiceBehavior: "Speak urgent items only",
    objective: "Classify incoming mail and prepare reply drafts.",
    guidelines: "Never send email without explicit approval.",
  },
  {
    id: "meeting-assistant",
    name: "Meeting Assistant",
    purpose: "Prepares agendas and captures follow-ups.",
    role: "Meetings",
    initials: "MA",
    suggestedTools: ["calendar", "tasks", "notifications"],
    recommendedPermissionNote: "Calendar read-only.",
    suggestedModelRole: "Everyday assistant",
    suggestedVoiceBehavior: "Voice off during meetings",
    objective: "Prepare agendas before meetings and extract action items after.",
    guidelines: "Attribute action items to owners explicitly.",
  },
  {
    id: "file-organizer",
    name: "File Organizer",
    purpose: "Keeps folders tidy and findable.",
    role: "Files",
    initials: "FO",
    suggestedTools: ["files"],
    recommendedPermissionNote: "Every file operation asks first.",
    suggestedModelRole: "Fast commands",
    suggestedVoiceBehavior: "Voice off",
    objective: "Propose consistent naming and folder structures.",
    guidelines: "Only propose moves; never move or delete without approval.",
  },
  {
    id: "screen-analyst",
    name: "Screen Analyst",
    purpose: "Explains what is currently on screen.",
    role: "Screen",
    initials: "SA",
    suggestedTools: ["screen-context", "notifications"],
    recommendedPermissionNote: "Screen Context asks every time.",
    suggestedModelRole: "Screen understanding",
    suggestedVoiceBehavior: "Spoken answers",
    objective: "Answer questions about captured screen context.",
    guidelines: "Only reads captures the user explicitly confirmed.",
  },
];

/** Prefills a wizard draft from a template (safe permission defaults kept). */
export function agentFromTemplate(template: AgentTemplate): AgentConfig {
  const agent = blankAgent();
  const permissions = defaultPermissions();
  return {
    ...agent,
    name: template.name,
    role: template.role,
    description: template.purpose,
    initials: template.initials,
    instructions: {
      ...agent.instructions,
      objective: template.objective,
      guidelines: template.guidelines,
    },
    permissions,
  };
}
