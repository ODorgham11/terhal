// Where each host's guards and sign-out send people. Paths are as the browser sees them on that host: proxy.ts rewrites
// admin.terhal.co/sign-in to app/admin/sign-in, so links never include the section (/admin, /staff, /site).
// The pages themselves come later; these are the names they'll live at.
export const adminRoutes = {
  home: "/",
  signIn: "/sign-in",
} as const;

export const staffRoutes = {
  home: "/",
  signIn: "/sign-in",
} as const;

export const siteRoutes = {
  home: "/",
  signIn: "/sign-in",
  // A customer who signed up confirms their email here.
  verify: "/verify",
  // Where a guest enters their details to book without an account, and confirms the emailed code.
  guest: "/guest",
  guestVerify: "/guest/verify",
} as const;

// The page to come back to after signing in, carried as ?next=. Only a path on this host: never another origin
// (//evil.example or https://...), so the parameter can't be used to send someone off-site.
export const safeNext = (value: string | null | undefined, fallback = "/") =>
  value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;

export const withNext = (path: string, next: string) =>
  next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
