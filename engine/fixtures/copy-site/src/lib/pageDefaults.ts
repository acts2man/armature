export type LinkDefault = { label: string; href: string };
export type DefaultValue = string | LinkDefault | Record<string, string>[];

export const PAGE_DEFAULTS: Record<string, Record<string, Record<string, DefaultValue>>> = {
  shared: {
    header: {
      logo: "/assets/logo.webp",
      logo_alt: "Tree Test Prep",
      nav: [
        { label: "Home", href: "/" },
        { label: "Course Overview", href: "/events/location/" },
      ],
    },
    footer: {
      copyright: "© 2026 Tree Test Prep. All Rights Reserved.",
    },
  },
  home: {
    hero: {
      title: "Become An ISA Certified Arborist",
      body: "Take your tree care career to the next level.",
      schedule: "Tuesdays · 6:00 – 8:30 PM",
      badge: "/assets/badge.webp",
      badge_alt: "ISA badge",
      cta: { label: "Register for the course", href: "/class-registration-page/" },
    },
    course: {
      weeks: [{ text: "Week 1: Tree Biology" }, { text: "Week 2: Soil Science" }],
    },
  },
  instructors: {
    intro: { heading: "Meet the instructors", role_label: "Instructor" },
  },
};
