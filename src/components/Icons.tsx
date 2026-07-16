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
