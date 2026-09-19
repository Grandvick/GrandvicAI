export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Set when the page is a placeholder — shown as a "Phase N" badge. */
  comingInPhase?: number;
};

/**
 * Sidebar navigation (spec section 53). Every route exists from Phase 0 so
 * the owner can see the full shape of the product; routes not yet built
 * show a "Coming in Phase N" placeholder instead of 404ing.
 */
export const navSections: { title?: string; items: NavItem[] }[] = [
  {
    items: [{ href: "/dashboard", label: "Dashboard", icon: "🏠" }],
  },
  {
    items: [
      { href: "/inbox", label: "Inbox", icon: "💬", comingInPhase: 5 },
      { href: "/leads", label: "Leads", icon: "👥" },
      { href: "/customers", label: "Customers", icon: "👤" },
      { href: "/tasks", label: "Tasks", icon: "✅" },
    ],
  },
  {
    items: [
      { href: "/jobs", label: "Jobs", icon: "💼", comingInPhase: 2 },
      { href: "/applications", label: "Applications", icon: "📄" },
      { href: "/documents", label: "Documents", icon: "📁" },
    ],
  },
  {
    items: [
      { href: "/marketing", label: "Marketing", icon: "📣", comingInPhase: 7 },
      { href: "/calendar", label: "Content Calendar", icon: "📅", comingInPhase: 7 },
    ],
  },
  {
    items: [
      { href: "/payments", label: "Payments", icon: "💰", comingInPhase: 9 },
      { href: "/analytics", label: "Analytics", icon: "📊", comingInPhase: 9 },
    ],
  },
  {
    items: [{ href: "/ai", label: "AI Command Centre", icon: "🤖", comingInPhase: 3 }],
  },
  {
    items: [{ href: "/settings", label: "Settings", icon: "⚙️" }],
  },
];
