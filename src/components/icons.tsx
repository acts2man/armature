/**
 * The inline stroke icon set from the approved screens: 24-unit grid, no fill,
 * 1.8 stroke, round caps and joins. Every icon is decorative by default
 * (aria-hidden); give it a `title` when it carries meaning on its own.
 */
import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  title?: string;
};

function make(name: string, children: ReactNode, strokeWidth = 1.8) {
  function Icon({ size = 18, title, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        className="shrink-0"
        data-icon={name}
        {...rest}
      >
        {title && <title>{title}</title>}
        {children}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

/** The Armature wire-A logo. Agency screens only. */
export const WireA = make(
  "WireA",
  <>
    <path d="M5 20 12 4l7 16M8 13.5h8" />
    <rect x="10.6" y="2.6" width="2.8" height="2.8" />
    <rect x="3.6" y="18.6" width="2.8" height="2.8" />
    <rect x="17.6" y="18.6" width="2.8" height="2.8" />
  </>,
  1.7,
);

export const IconChevronDown = make("ChevronDown", <path d="m6 9 6 6 6-6" />);
export const IconChevronRight = make("ChevronRight", <path d="m9 6 6 6-6 6" />);
export const IconChevronUp = make("ChevronUp", <path d="m6 15 6-6 6 6" />);
export const IconGlobe = make(
  "Globe",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
  </>,
);
export const IconBranch = make(
  "Branch",
  <>
    <circle cx="6" cy="5" r="2.5" />
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 7.5v9M18 10.5c0 4-6 3-12 6" />
  </>,
);
export const IconTeam = make(
  "Team",
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-3.5-5.4" />
  </>,
);
export const IconPalette = make(
  "Palette",
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1.2" />
    <circle cx="12" cy="7.5" r="1.2" />
    <circle cx="15.5" cy="10" r="1.2" />
  </>,
);
export const IconSettings = make(
  "Settings",
  <>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </>,
);
export const IconPlus = make("Plus", <path d="M12 5v14M5 12h14" />);
export const IconCheck = make("Check", <path d="m5 12 5 5 9-10" />);
export const IconClock = make(
  "Clock",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const IconEye = make(
  "Eye",
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = make(
  "EyeOff",
  <>
    <path d="M3 3l18 18M10.6 5.3A11 11 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6C3.7 8.6 2 12 2 12s3.6 7 10 7c1.5 0 2.9-.4 4.1-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </>,
);
export const IconUndo = make(
  "Undo",
  <>
    <path d="M8 6 3 11l5 5" />
    <path d="M3 11h11a6 6 0 0 1 6 6v1" />
  </>,
);
export const IconGrid = make(
  "Grid",
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
);
export const IconPage = make(
  "Page",
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>,
);
export const IconInbox = make(
  "Inbox",
  <>
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
  </>,
);
export const IconImage = make(
  "Image",
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-8 8" />
  </>,
);
export const IconSearch = make(
  "Search",
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const IconChart = make("Chart", <path d="M5 20V10M12 20V4M19 20v-7" />);
export const IconPencil = make(
  "Pencil",
  <>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13 7 4 4" />
  </>,
);
export const IconSend = make("Send", <path d="M4 12 20 4l-6 16-3-7z" />);
export const IconCalendar = make(
  "Calendar",
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>,
);
export const IconMail = make(
  "Mail",
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </>,
);
export const IconKey = make(
  "Key",
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M16 7l3 3" />
  </>,
);
export const IconLayers = make(
  "Layers",
  <>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </>,
);
export const IconHeading = make("Heading", <path d="M5 6V4h14v2M12 4v16M9 20h6" />);
export const IconParagraph = make("Paragraph", <path d="M4 6h16M4 12h10M4 18h13" />);
export const IconLink = make(
  "Link",
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>,
);
export const IconArrowUp = make("ArrowUp", <path d="M12 19V5M6 11l6-6 6 6" />);
export const IconArrowDown = make("ArrowDown", <path d="M12 5v14M6 13l6 6 6-6" />);
export const IconArrowLeft = make("ArrowLeft", <path d="M19 12H5M11 18l-6-6 6-6" />);
export const IconTrash = make("Trash", <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />);
export const IconLock = make(
  "Lock",
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);
export const IconExternal = make(
  "External",
  <>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
  </>,
);
export const IconMenu = make("Menu", <path d="M4 7h16M4 12h16M4 17h16" />);
export const IconX = make("X", <path d="M6 6l12 12M18 6 6 18" />);
export const IconLogout = make(
  "Logout",
  <>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    <path d="m15 8 5 4-5 4M20 12H9" />
  </>,
);
export const IconRefresh = make(
  "Refresh",
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </>,
);
export const IconAlert = make(
  "Alert",
  <>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 9v5M12 17.5v.5" />
  </>,
);
export const IconInfo = make(
  "Info",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </>,
);
export const IconXCircle = make(
  "XCircle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </>,
);
export const IconCheckCircle = make(
  "CheckCircle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </>,
);
export const IconDashedCircle = make("DashedCircle", <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />);
export const IconCopy = make(
  "Copy",
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </>,
);
export const IconHistory = make(
  "History",
  <>
    <path d="M4 12a8 8 0 1 0 2.3-5.7" />
    <path d="M4 4v5h5M12 8v4l3 2" />
  </>,
);
export const IconGithub = make(
  "Github",
  <>
    <path d="M9 19c-4 1.2-4-2-6-2.5M15 21v-3.4a3 3 0 0 0-.8-2.3c2.8-.3 5.8-1.4 5.8-6.2a4.8 4.8 0 0 0-1.3-3.3 4.5 4.5 0 0 0-.1-3.3s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.2 5.4 2.5 5.4 2.5a4.5 4.5 0 0 0-.1 3.3A4.8 4.8 0 0 0 4 9.1c0 4.8 3 5.9 5.8 6.2a3 3 0 0 0-.8 2.3V21" />
  </>,
);
export const IconSparkle = make(
  "Sparkle",
  <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
);
export const IconUser = make(
  "User",
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </>,
);
export const IconBuilding = make(
  "Building",
  <>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
  </>,
);
export const IconUpload = make(
  "Upload",
  <>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </>,
);
export const IconStethoscope = make(
  "Stethoscope",
  <>
    <path d="M5 4v6a4 4 0 0 0 8 0V4" />
    <path d="M9 14v2a5 5 0 0 0 10 0v-2" />
    <circle cx="19" cy="11" r="2" />
  </>,
);
