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
export const IconHelp = make(
  "Help",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.4-1 2-2.5 2.5v1.5" />
    <path d="M12 17.5v.5" />
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

// --- visual editor -------------------------------------------------------------------------
export const IconRedo = make(
  "Redo",
  <>
    <path d="m16 6 5 5-5 5" />
    <path d="M21 11H10a6 6 0 0 0-6 6v1" />
  </>,
);
export const IconDesktop = make(
  "Desktop",
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const IconTablet = make(
  "Tablet",
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M11 17.5h2" />
  </>,
);
export const IconPhone = make(
  "Phone",
  <>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 17.5h2" />
  </>,
);
export const IconGrip = make(
  "Grip",
  <>
    <circle cx="9" cy="6" r="1.2" />
    <circle cx="15" cy="6" r="1.2" />
    <circle cx="9" cy="12" r="1.2" />
    <circle cx="15" cy="12" r="1.2" />
    <circle cx="9" cy="18" r="1.2" />
    <circle cx="15" cy="18" r="1.2" />
  </>,
);
export const IconKeyboard = make(
  "Keyboard",
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </>,
);
export const IconSection = make(
  "Section",
  <>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </>,
);
export const IconLayout = make(
  "Layout",
  <>
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
  </>,
);
export const IconVideo = make(
  "Video",
  <>
    <rect x="3" y="5" width="13" height="14" rx="2" />
    <path d="m16 10 5-3v10l-5-3z" />
  </>,
);
export const IconPointer = make(
  "Pointer",
  <>
    <path d="M5 4l14 7-6 2-3 6z" />
  </>,
);

// --- page builder ---------------------------------------------------------------------------
export const IconSpacer = make("Spacer", <path d="M4 5h16M4 19h16M12 9v6M9.5 11.5 12 9l2.5 2.5M9.5 12.5 12 15l2.5-2.5" />);
export const IconDivider = make("Divider", <path d="M4 12h16M7 6h10M7 18h10" />);
export const IconBox = make("Box", <rect x="4" y="4" width="16" height="16" rx="2" />);
export const IconMove = make("Move", <path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" />);
export const IconTree = make("Tree", <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />);
export const IconUnlock = make(
  "Unlock",
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </>,
);
export const IconMore = make(
  "More",
  <>
    <circle cx="6" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="18" cy="12" r="1.2" />
  </>,
);
export const IconWidget = make(
  "Widget",
  <>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
    <path d="M17 3v8M13 7h8M3 17h8M7 13v8" />
  </>,
);
export const IconTemplate = make(
  "Template",
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </>,
);
export const IconBold = make("Bold", <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />);
export const IconItalic = make("Italic", <path d="M10 5h8M6 19h8M14 5l-4 14" />);
export const IconUnderline = make("Underline", <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />);
export const IconStrike = make("Strike", <path d="M4 12h16M8 8a4 3 0 0 1 8 0M8 16a4 3 0 0 0 8 0" />);
export const IconListBullet = make(
  "ListBullet",
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </>,
);
export const IconListOrdered = make("ListOrdered", <path d="M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M4 14h2l-2 2.5h2M4 18" />);
export const IconAlignLeft = make("AlignLeft", <path d="M4 6h16M4 12h10M4 18h13" />);
export const IconAlignCenter = make("AlignCenter", <path d="M4 6h16M7 12h10M5.5 18h13" />);
export const IconAlignRight = make("AlignRight", <path d="M4 6h16M10 12h10M7 18h13" />);
export const IconAlignJustify = make("AlignJustify", <path d="M4 6h16M4 12h16M4 18h16" />);
export const IconDroplet = make("Droplet", <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />);
export const IconEraser = make("Eraser", <path d="m7 20 9.5-9.5a2 2 0 0 0 0-2.8l-2.2-2.2a2 2 0 0 0-2.8 0L3 14a2 2 0 0 0 0 2.8L6.2 20zM6 12l6 6M11 20h10" />);
export const IconSliders = make("Sliders", <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4" />);
export const IconPaste = make(
  "Paste",
  <>
    <rect x="7" y="4" width="10" height="16" rx="2" />
    <path d="M10 4V3h4v1M10 10h4M10 14h4" />
  </>,
);
export const IconArrowRight = make("ArrowRight", <path d="M5 12h14M13 6l6 6-6 6" />);
export const IconCornerUp = make("CornerUp", <path d="M14 5l5 5-5 5M19 10H8a4 4 0 0 0-4 4v5" />);

// --- widget library (from lucide, ISC) ---------------------------------------------------------
export const IconStar = make("Star", <><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></>);
export const IconQuote = make("Quote", <><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /></>);
export const IconTabs = make("Tabs", <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></>);
export const IconAccordion = make("Accordion", <><path d="M10 5h11" /><path d="M10 12h11" /><path d="M10 19h11" /><path d="m3 10 3-3-3-3" /><path d="m3 20 3-3-3-3" /></>);
export const IconToggle = make("Toggle", <><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></>);
export const IconMapPin = make("MapPin", <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>);
export const IconTimer = make("Timer", <><line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" /></>);
export const IconCode = make("Code", <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>);
export const IconForm = make("Form", <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>);
export const IconShare = make("Share", <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></>);
export const IconHash = make("Hash", <><line x1="4" x2="20" y1="9" y2="9" /><line x1="4" x2="20" y1="15" y2="15" /><line x1="10" x2="8" y1="3" y2="21" /><line x1="16" x2="14" y1="3" y2="21" /></>);
export const IconGauge = make("Gauge", <><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>);
export const IconFlip = make("Flip", <><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></>);
export const IconGallery = make("Gallery", <><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>);
export const IconCarousel = make("Carousel", <><path d="M2 3v18" /><rect width="12" height="18" x="6" y="3" rx="2" /><path d="M22 3v18" /></>);
export const IconPrice = make("Price", <><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 18V6" /></>);
export const IconMegaphone = make("Megaphone", <><path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" /><path d="M8 6v8" /></>);
export const IconListChecks = make("ListChecks", <><path d="M13 5h8" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /></>);
export const IconTestimonial = make("Testimonial", <><path d="M14 14a2 2 0 0 0 2-2V8h-2" /><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M8 14a2 2 0 0 0 2-2V8H8" /></>);
export const IconWarning = make("Warning", <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>);
export const IconPlay = make("Play", <><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" /><circle cx="12" cy="12" r="10" /></>);
export const IconSmile = make("Smile", <><path d="M15 10V9" /><path d="M16.472 15a6 6 0 01-8.943 0" /><path d="M9 10V9" /><circle cx="12" cy="12" r="10" /></>);
export const IconIconBox = make("IconBox", <><path d="M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" /><path d="M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" /><rect width="8" height="8" x="14" y="14" rx="2" /></>);
export const IconImageBox = make("ImageBox", <><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M7 21v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" /></>);
export const IconToc = make("Toc", <><path d="M16 5H3" /><path d="M16 12H3" /><path d="M16 19H3" /><path d="M21 5h.01" /><path d="M21 12h.01" /><path d="M21 19h.01" /></>);
