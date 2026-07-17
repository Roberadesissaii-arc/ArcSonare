/**
 * Clearly-marked local demo data. Nothing here comes from a real calendar,
 * mailbox or agent runtime — it exists so the Command Center has believable
 * content before integrations arrive.
 */
import type { IntegrationId } from "../config/iconRegistry";

export const DEMO_TASKS = [
  {
    id: "demo-investor-update",
    title: "Investor update due",
    note: "Final numbers and narrative for the monthly investor email.",
    priority: "high" as const,
    due: "Today, 12:00 PM",
    dueBucket: "today" as const,
    agent: "Project Manager",
    completed: false,
    urgent: true,
    demo: true,
    createdAt: 0,
  },
  {
    id: "demo-budget-approval",
    title: "Budget approval",
    note: "Q3 tooling budget is waiting on you.",
    priority: "medium" as const,
    due: "Waiting on you",
    dueBucket: "today" as const,
    agent: "Project Manager",
    completed: false,
    urgent: true,
    demo: true,
    createdAt: 0,
  },
  {
    id: "demo-security-review",
    title: "Security review",
    note: "Walk through the access audit findings.",
    priority: "low" as const,
    due: "Today, 03:00 PM",
    dueBucket: "today" as const,
    completed: false,
    urgent: true,
    demo: true,
    createdAt: 0,
  },
  {
    id: "demo-market-data",
    title: "Review market data",
    note: "Fresh scan results land before the briefing.",
    priority: "medium" as const,
    due: "Today, 11:30 AM",
    dueBucket: "today" as const,
    agent: "Research Analyst",
    completed: false,
    urgent: false,
    demo: true,
    createdAt: 0,
  },
  {
    id: "demo-strategy-deck",
    title: "Strategy deck outline",
    note: "Structure the quarterly narrative.",
    priority: "medium" as const,
    due: "Tomorrow",
    dueBucket: "upcoming" as const,
    agent: "Content Creator",
    completed: false,
    urgent: false,
    demo: true,
    createdAt: 0,
  },
  {
    id: "demo-launch-notes",
    title: "Publish launch notes",
    priority: "low" as const,
    due: "Friday",
    dueBucket: "upcoming" as const,
    completed: false,
    urgent: false,
    demo: true,
    createdAt: 0,
  },
  {
    id: "demo-sync-prep",
    title: "Prepare client sync agenda",
    priority: "low" as const,
    due: "Done",
    dueBucket: "none" as const,
    completed: true,
    urgent: false,
    demo: true,
    createdAt: 0,
  },
];

export interface UpNextEvent {
  time: string;
  title: string;
  place: string;
  integration?: IntegrationId;
}

export const UP_NEXT: UpNextEvent[] = [
  {
    time: "10:00 AM",
    title: "Launch briefing",
    place: "Conference Room · Teams",
    integration: "teams",
  },
  { time: "11:30 AM", title: "Review market data", place: "Workspace" },
  { time: "01:00 PM", title: "Client sync", place: "Zoom", integration: "zoom" },
  { time: "03:30 PM", title: "Quarterly planning", place: "Workspace" },
  {
    time: "05:00 PM",
    title: "Design review",
    place: "Figma",
    integration: "figma",
  },
];

export interface FocusSubtask {
  label: string;
  done: boolean;
}

export const FOCUS = {
  title: "Launch briefing in 32 min",
  description: "Prepare slides, sync data, review risks.",
  subtasks: [
    { label: "Collect launch metrics", done: true },
    { label: "Sync deck data", done: true },
    { label: "Draft opening summary", done: true },
    { label: "Review market data", done: false },
    { label: "Confirm attendee list", done: false },
    { label: "Final risk pass", done: false },
  ] as FocusSubtask[],
  next: "Review market data",
};

export interface ConnectedTool {
  id: IntegrationId;
  name: string;
  purpose: string;
}

export const CONNECTED_TOOLS: ConnectedTool[] = [
  { id: "notion", name: "Notion", purpose: "Connected" },
  { id: "slack", name: "Slack", purpose: "Connected" },
  { id: "googleDrive", name: "Google Drive", purpose: "Connected" },
  { id: "outlook", name: "Outlook", purpose: "Connected" },
];

export interface OrbitChip {
  icon: "search" | "tasks" | "calendar" | "agent";
  label: string;
  status: string;
}

/** Objects orbiting the core; orbit geometry lives in the map. */
export const ORBIT_CHIPS: OrbitChip[] = [
  { icon: "search", label: "Market scan", status: "Updating" },
  { icon: "tasks", label: "Strategy deck", status: "In progress" },
  { icon: "calendar", label: "Client sync", status: "In 15 min" },
  { icon: "agent", label: "Inbox triage", status: "Queued" },
];

export type AgentStatus =
  | "Ready"
  | "Paused"
  | "Waiting"
  | "Running locally"
  | "Not configured";

export interface AgentInfo {
  id: string;
  name: string;
  initials: string;
  purpose: string;
  status: AgentStatus;
  recentAction: string;
  enabled: boolean;
}

export const AGENTS: AgentInfo[] = [
  {
    id: "project-manager",
    name: "Project Manager",
    initials: "PM",
    purpose: "Keeps tasks, owners and deadlines aligned.",
    status: "Ready",
    recentAction: "Reordered today's tasks around the launch briefing.",
    enabled: true,
  },
  {
    id: "research-analyst",
    name: "Research Analyst",
    initials: "RA",
    purpose: "Scans sources and summarizes what changed.",
    status: "Running locally",
    recentAction: "Market scan in progress — 3 sources summarized.",
    enabled: true,
  },
  {
    id: "content-creator",
    name: "Content Creator",
    initials: "CC",
    purpose: "Drafts documents, decks and messages.",
    status: "Waiting",
    recentAction: "Strategy deck outline waiting for your review.",
    enabled: false,
  },
];

export interface IntegrationInfo {
  id: IntegrationId;
  name: string;
  category: string;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  { id: "gmail", name: "Gmail", category: "Email" },
  { id: "outlook", name: "Outlook", category: "Email" },
  { id: "googleCalendar", name: "Google Calendar", category: "Calendar" },
  { id: "teams", name: "Microsoft Teams", category: "Meetings" },
  { id: "slack", name: "Slack", category: "Messaging" },
  { id: "notion", name: "Notion", category: "Workspace" },
  { id: "googleDrive", name: "Google Drive", category: "Files" },
  { id: "onedrive", name: "OneDrive", category: "Files" },
  { id: "dropbox", name: "Dropbox", category: "Files" },
  { id: "linear", name: "Linear", category: "Issues" },
  { id: "github", name: "GitHub", category: "Code" },
  { id: "discord", name: "Discord", category: "Community" },
  { id: "zoom", name: "Zoom", category: "Meetings" },
  { id: "trello", name: "Trello", category: "Boards" },
  { id: "figma", name: "Figma", category: "Design" },
  { id: "clickup", name: "ClickUp", category: "Projects" },
  { id: "todoist", name: "Todoist", category: "Tasks" },
  { id: "telegram", name: "Telegram", category: "Messaging" },
  { id: "whatsapp", name: "WhatsApp", category: "Messaging" },
  { id: "googleMeet", name: "Google Meet", category: "Meetings" },
  { id: "googleDocs", name: "Google Docs", category: "Documents" },
  { id: "googleSheets", name: "Google Sheets", category: "Spreadsheets" },
  { id: "evernote", name: "Evernote", category: "Notes" },
  { id: "onenote", name: "OneNote", category: "Notes" },
  { id: "loom", name: "Loom", category: "Video" },
  { id: "spotify", name: "Spotify", category: "Audio" },
  { id: "youtube", name: "YouTube", category: "Video" },
];
