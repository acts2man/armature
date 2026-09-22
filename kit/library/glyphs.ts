/**
 * The few icons the widget library draws itself (chevrons, checks, alerts, contact
 * glyphs), copied from lucide (ISC/MIT), and simple stroke glyphs for social networks
 * (after lucide's retired brand set and tabler icons, MIT). Same node format as icons
 * saved in elements, rendered by <Icon>.
 */
import type { IconValue, SocialNetwork } from "../types.ts";

export const GLYPHS = {
  chevronDown: {"name":"ChevronDown","nodes":[["path",{"d":"m6 9 6 6 6-6"}]]},
  chevronLeft: {"name":"ChevronLeft","nodes":[["path",{"d":"m15 18-6-6 6-6"}]]},
  chevronRight: {"name":"ChevronRight","nodes":[["path",{"d":"m9 18 6-6-6-6"}]]},
  plus: {"name":"Plus","nodes":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]]},
  minus: {"name":"Minus","nodes":[["path",{"d":"M5 12h14"}]]},
  check: {"name":"Check","nodes":[["path",{"d":"M20 6 9 17l-5-5"}]]},
  x: {"name":"X","nodes":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]]},
  play: {"name":"Play","nodes":[["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]]},
  info: {"name":"Info","nodes":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]]},
  circleCheck: {"name":"CircleCheck","nodes":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16 9-5.5 5.5L8 12"}]]},
  triangleAlert: {"name":"TriangleAlert","nodes":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]]},
  circleAlert: {"name":"CircleAlert","nodes":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]]},
  mail: {"name":"Mail","nodes":[["path",{"d":"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"}],["rect",{"x":"2","y":"4","width":"20","height":"16","rx":"2"}]]},
  phone: {"name":"Phone","nodes":[["path",{"d":"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]]},
  globe: {"name":"Globe","nodes":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]]},
  rss: {"name":"Rss","nodes":[["path",{"d":"M4 11a9 9 0 0 1 9 9"}],["path",{"d":"M4 4a16 16 0 0 1 16 16"}],["circle",{"cx":"5","cy":"19","r":"1"}]]},
  messageCircle: {"name":"MessageCircle","nodes":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]]},
  list: {"name":"List","nodes":[["path",{"d":"M3 5h.01"}],["path",{"d":"M3 12h.01"}],["path",{"d":"M3 19h.01"}],["path",{"d":"M8 5h13"}],["path",{"d":"M8 12h13"}],["path",{"d":"M8 19h13"}]]},
  quote: {"name":"Quote","nodes":[["path",{"d":"M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"}],["path",{"d":"M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"}]]},
  mapPin: {"name":"MapPin","nodes":[["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]]},
} satisfies Record<string, IconValue>;

const stroke = (name: string, nodes: IconValue["nodes"]): IconValue => ({ name, nodes });

/** One glyph per network, and the network's own colour for the "brand" look. */
export const NETWORKS: Record<SocialNetwork, { label: string; color: string; icon: IconValue }> = {
  facebook: { label: "Facebook", color: "#1877f2", icon: stroke("facebook", [["path", { d: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" }]]) },
  instagram: { label: "Instagram", color: "#e1306c", icon: stroke("instagram", [["rect", { width: "20", height: "20", x: "2", y: "2", rx: "5", ry: "5" }], ["path", { d: "M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" }], ["line", { x1: "17.5", x2: "17.51", y1: "6.5", y2: "6.5" }]]) },
  x: { label: "X", color: "#000000", icon: stroke("x", [["path", { d: "M4 4l11.733 16h4.267l-11.733 -16z" }], ["path", { d: "M4 20l6.768 -6.768" }], ["path", { d: "M13.228 10.772l6.772 -6.772" }]]) },
  twitter: { label: "Twitter", color: "#1da1f2", icon: stroke("twitter", [["path", { d: "M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" }]]) },
  linkedin: { label: "LinkedIn", color: "#0a66c2", icon: stroke("linkedin", [["path", { d: "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" }], ["rect", { width: "4", height: "12", x: "2", y: "9" }], ["circle", { cx: "4", cy: "4", r: "2" }]]) },
  youtube: { label: "YouTube", color: "#ff0000", icon: stroke("youtube", [["path", { d: "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" }], ["path", { d: "m10 15 5-3-5-3z" }]]) },
  tiktok: { label: "TikTok", color: "#000000", icon: stroke("tiktok", [["path", { d: "M21 7.917v4.034a9.948 9.948 0 0 1 -5 -1.951v4.5a6.5 6.5 0 1 1 -8 -6.326v4.326a2.5 2.5 0 1 0 4 2v-11.5h4.083a6.005 6.005 0 0 0 4.917 4.917z" }]]) },
  pinterest: { label: "Pinterest", color: "#e60023", icon: stroke("pinterest", [["path", { d: "M8 20l4 -9" }], ["path", { d: "M10.7 14c.437 1.263 1.43 2 2.55 2c2.071 0 3.75 -1.554 3.75 -4a5 5 0 1 0 -9.7 1.7" }], ["circle", { cx: "12", cy: "12", r: "9" }]]) },
  github: { label: "GitHub", color: "#181717", icon: stroke("github", [["path", { d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" }], ["path", { d: "M9 18c-4.51 2-5-2-7-2" }]]) },
  email: { label: "Email", color: "#5f6b76", icon: GLYPHS.mail },
  phone: { label: "Phone", color: "#176b43", icon: GLYPHS.phone },
  website: { label: "Website", color: "#24339f", icon: GLYPHS.globe },
  rss: { label: "RSS", color: "#ee802f", icon: GLYPHS.rss },
  whatsapp: { label: "WhatsApp", color: "#25d366", icon: GLYPHS.messageCircle },
};
