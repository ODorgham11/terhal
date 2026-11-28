import { NextResponse, type NextRequest } from "next/server";
import { sectionOf } from "@/lib/hosts";

// One app, three hostnames, each its own origin so a bug on one can't act on another:
// admin.terhal.co is served from app/admin, dashboard.terhal.co from app/staff, and terhal.co (the customer site) from
// app/site. Staging (*.staging.terhal.co) and local development (*.local.terhal.co) follow the same prefixes. Rewriting
// every path means one host's pages can't be reached from another. This is routing only: the backend still enforces who
// can do what.
export function proxy(request: NextRequest) {
  const section = sectionOf(request.headers.get("host"));
  const url = request.nextUrl.clone();

  url.pathname = `/${section}${url.pathname === "/" ? "" : url.pathname}`;

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
