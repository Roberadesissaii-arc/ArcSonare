/**
 * Central icon mapping.
 *
 * `uiIcons` — the monochrome outline components used across the interface.
 * `integrationIcons` — official application logos copied from the local ICO
 * library (highest-resolution PNG frame extracted from each .ico). These
 * keep their brand colors; everything else in ArcSonare stays monochrome.
 */
import type { ComponentType } from "react";
import {
  ArrowUpIcon,
  BellIcon,
  BotIcon,
  CalendarIcon,
  CloseIcon,
  GearIcon,
  HelpIcon,
  InfoIcon,
  KeyboardIcon,
  LayoutIcon,
  ListIcon,
  MessageIcon,
  MinimizeIcon,
  PaletteIcon,
  PlugIcon,
  PlusIcon,
  PowerIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  TrashIcon,
  WaveIcon,
} from "../components/Icons";

import gmail from "../assets/icons/integrations/gmail.png";
import outlook from "../assets/icons/integrations/outlook.png";
import googleCalendar from "../assets/icons/integrations/google-calendar.png";
import slack from "../assets/icons/integrations/slack.png";
import teams from "../assets/icons/integrations/teams.png";
import notion from "../assets/icons/integrations/notion.png";
import googleDrive from "../assets/icons/integrations/google-drive.png";
import onedrive from "../assets/icons/integrations/onedrive.png";
import dropbox from "../assets/icons/integrations/dropbox.png";
import linear from "../assets/icons/integrations/linear.png";
import github from "../assets/icons/integrations/github.png";
import discord from "../assets/icons/integrations/discord.png";
import zoom from "../assets/icons/integrations/zoom.png";
import trello from "../assets/icons/integrations/trello.png";

export type UiIconName =
  | "general"
  | "shortcuts"
  | "appearance"
  | "notifications"
  | "privacy"
  | "connect"
  | "about"
  | "settings"
  | "close"
  | "minimize"
  | "search"
  | "add"
  | "voice"
  | "tasks"
  | "agent"
  | "dashboard"
  | "calendar"
  | "showApp"
  | "updates"
  | "feedback"
  | "help"
  | "quit"
  | "clearData";

export const uiIcons: Record<UiIconName, ComponentType<{ size?: number }>> = {
  general: SlidersIcon,
  shortcuts: KeyboardIcon,
  appearance: PaletteIcon,
  notifications: BellIcon,
  privacy: ShieldIcon,
  connect: PlugIcon,
  about: InfoIcon,
  settings: GearIcon,
  close: CloseIcon,
  minimize: MinimizeIcon,
  search: SearchIcon,
  add: PlusIcon,
  voice: WaveIcon,
  tasks: ListIcon,
  agent: BotIcon,
  dashboard: LayoutIcon,
  calendar: CalendarIcon,
  showApp: ArrowUpIcon,
  updates: RefreshIcon,
  feedback: MessageIcon,
  help: HelpIcon,
  quit: PowerIcon,
  clearData: TrashIcon,
};

export type IntegrationId =
  | "gmail"
  | "outlook"
  | "googleCalendar"
  | "slack"
  | "teams"
  | "notion"
  | "googleDrive"
  | "onedrive"
  | "dropbox"
  | "linear"
  | "github"
  | "discord"
  | "zoom"
  | "trello";

export const integrationIcons: Record<IntegrationId, string> = {
  gmail,
  outlook,
  googleCalendar,
  slack,
  teams,
  notion,
  googleDrive,
  onedrive,
  dropbox,
  linear,
  github,
  discord,
  zoom,
  trello,
};
