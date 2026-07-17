/**
 * Shared monochrome outline icons (Lucide-style geometry: 24px grid, 1.7px
 * stroke, round caps/joins). All icons inherit `currentColor` and are sized
 * by the `size` prop (default 16px).
 */

interface IconProps {
  size?: number;
}

function base(size: number | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function GearIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function MonitorIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export function VolumeIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

export function DatabaseIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

export function MicIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
    </svg>
  );
}

export function PlayIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m7 4 13 8-13 8V4z" />
    </svg>
  );
}

export function PauseIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export function StopIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function PenIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function SquareIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

export function CircleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function HighlighterIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4Z" />
    </svg>
  );
}

export function BlurIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0Z" />
      <path d="M12 22V8" />
    </svg>
  );
}

export function UndoIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}

export function RedoIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
    </svg>
  );
}

export function CursorIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m4 4 7.1 16.5 2.2-6.6 6.6-2.2Z" />
    </svg>
  );
}

export function DownloadIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

export function FolderIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function KeyIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m21 2-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m3 3L21 8m-3-3 3 3" />
    </svg>
  );
}

export function UserIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function ZapIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export function LayersIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

export function CpuIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </svg>
  );
}

export function SlidersIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1.5 14h5M9.5 8h5M17.5 16h5" />
    </svg>
  );
}

export function KeyboardIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
    </svg>
  );
}

export function PaletteIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19c.87 0 1.55-.7 1.55-1.58 0-.41-.17-.79-.41-1.06-.27-.27-.41-.61-.41-1.06a1.55 1.55 0 0 1 1.57-1.57h1.87a5.71 5.71 0 0 0 5.33-5.23A9.5 9.5 0 0 0 12 2.5Z" />
      <circle cx="13.5" cy="6.7" r="0.6" fill="currentColor" />
      <circle cx="17.3" cy="10.2" r="0.6" fill="currentColor" />
      <circle cx="8.6" cy="7.6" r="0.6" fill="currentColor" />
      <circle cx="6.7" cy="12.3" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function BellIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function ShieldIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
    </svg>
  );
}

export function ShieldCheckIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
      <path d="M9 11.5l2 2 4-4" />
    </svg>
  );
}

export function PlugIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8Z" />
      <path d="M12 18v4" />
    </svg>
  );
}

export function InfoIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11v5.5M12 7.6h.01" />
    </svg>
  );
}

export function CloseIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function MinimizeIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function ArrowUpIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function ArrowRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

export function RefreshIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  );
}

export function MessageIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />
    </svg>
  );
}

export function HelpIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M9.2 9a2.9 2.9 0 0 1 5.6 1c0 1.8-2.6 2.3-2.6 3.8M12 17.4h.01" />
    </svg>
  );
}

export function PowerIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 2v9" />
      <path d="M17.6 5.6a8 8 0 1 1-11.2 0" />
    </svg>
  );
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronLeftIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function TrashIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

export function SearchIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function PlusIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Vertical audio-lines mark used for voice actions (never a microphone). */
export function WaveIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2 10v4M6 7v10M10 4v16M14 8v8M18 6v12M22 10v4" />
    </svg>
  );
}

export function MoonIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" />
    </svg>
  );
}

export function WarningIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l9.5 17h-19L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function DotsIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="5" cy="12" r="0.9" fill="currentColor" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
      <circle cx="19" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function SparkleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}

export function SendIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

export function CalendarIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
    </svg>
  );
}

export function ClockIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 7v5l3.2 1.8" />
    </svg>
  );
}

export function ListIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function BotIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M9 2.5h6" />
      <path d="M9 13h.01M15 13h.01M9.5 16.5h5" />
    </svg>
  );
}

export function LayoutIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 10h18M10 10v11" />
    </svg>
  );
}

export function TargetArrowIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <circle cx="12" cy="12" r="4.5" />
    </svg>
  );
}

export function FileTextIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" />
      <path d="M14 2v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export function MailIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}

export function ChartIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M8 16v-5M13 16V8M18 16v-8" />
    </svg>
  );
}

export function CheckSquareIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}

export function UsersIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 5a3.5 3.5 0 0 1 0 6.7M21.5 20.5c0-2.9-1.9-5-4.5-5.7" />
    </svg>
  );
}
