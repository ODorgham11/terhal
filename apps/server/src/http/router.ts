import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { auditRoutes } from "../modules/audit/index";
import {
  adminAccountRoutes,
  adminAuthRoutes,
  adminInvitationRoutes,
  adminManagementRoutes,
  adminStaffRoutes,
  customerAuthRoutes,
  guestRoutes,
  staffAuthRoutes,
} from "../modules/identity/index";
import { env, origins, type Audience } from "../platform/config/env";
import {
  ADMIN_COOKIE_AUTH,
  CUSTOMER_COOKIE_AUTH,
  GUEST_COOKIE_AUTH,
  STAFF_COOKIE_AUTH,
  guestCookie,
  sessionCookieNames,
} from "../platform/http/authenticate";
import { requireOrigin } from "../platform/http/origin";
import { createRouter } from "../platform/http/router";
import { notFound, onError } from "./errors";
import { health } from "./health";
import { accessLog, bodyLimit, requestContext, requestId, timeout } from "./middleware";

// Composition root: global middleware and every module's routes are mounted here. Order matters: the request id and its
// context first, so everything after (including errors) can log with it.
export const router = createRouter();

router.use(requestId);
router.use(requestContext);
router.use(accessLog);
router.use(timeout);
router.use(bodyLimit);
router.use(secureHeaders());

// The customer site, the staff dashboard and the admin panel are separate origins, and each may only call its own
// routes. Every auth cookie reaches the API from all three (they're the same site), so without this a bug on the customer
// site could read or act through an admin's session.
const audience = (name: Audience) =>
  [cors({ origin: origins[name], credentials: true }), requireOrigin([origins[name]])] as const;

router.use("/v1/admin/*", ...audience("admin"));
router.use("/v1/staff/*", ...audience("staff"));
router.use("/v1/site/*", ...audience("site"));

// Every module's routes, versioned. Chained, so the type below carries every route for the web app's RPC client.
const v1 = createRouter()
  .route("/", adminAuthRoutes)
  .route("/", adminAccountRoutes)
  .route("/", adminInvitationRoutes)
  .route("/", adminManagementRoutes)
  .route("/", adminStaffRoutes)
  .route("/", auditRoutes)
  .route("/", staffAuthRoutes)
  .route("/", customerAuthRoutes)
  .route("/", guestRoutes);

export const routes = router.route("/health", health).route("/v1", v1);

// The web app's typed client (hono/client) is built from this.
export type AppType = typeof routes;

// The API's contract, and a browsable page for it. Not served in production: they list every route.
const cookieSchemes = [
  [
    ADMIN_COOKIE_AUTH,
    sessionCookieNames.admin.accessCookie,
    "Set by signing in to the admin panel (httpOnly).",
  ],
  [
    STAFF_COOKIE_AUTH,
    sessionCookieNames.staff.accessCookie,
    "Set by signing in to the dashboard (httpOnly).",
  ],
  [
    CUSTOMER_COOKIE_AUTH,
    sessionCookieNames.customer.accessCookie,
    "Set by a customer signing in (httpOnly).",
  ],
  [GUEST_COOKIE_AUTH, guestCookie.name, "Set by verifying a guest's contact details (httpOnly)."],
] as const;

for (const [scheme, name, description] of cookieSchemes) {
  router.openAPIRegistry.registerComponent("securitySchemes", scheme, {
    type: "apiKey",
    in: "cookie",
    name,
    description,
  });
}

if (env.APP_ENV !== "production") {
  router.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Terhal API", version: "1" },
  });
  router.get(
    "/v1/docs",
    Scalar({
      url: "/v1/openapi.json",
      pageTitle: "Terhal API",
      // Pinned: the default loads whatever version jsDelivr serves as latest, unreviewed. Setting `cdn` makes the page
      // load a classic <script src>, so this must be the standalone build.
      cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/dist/browser/standalone.js",
    }),
  );
}

router.notFound(notFound);
router.onError(onError);
