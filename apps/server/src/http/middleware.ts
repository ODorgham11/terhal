import { VEHICLE_IMAGE_MAX_BYTES } from "@terhal/contracts";
import { bodyLimit as honoBodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { requestId as honoRequestId } from "hono/request-id";
import { routePath } from "hono/route";
import { timeout as honoTimeout } from "hono/timeout";
import { runWithContext } from "../platform/context/request-context";
import { logger } from "../platform/logger/logger";

// Takes the client's X-Request-Id when it is a short, safe token (so the web app can correlate its
// own logs), otherwise generates one. Echoed back on every response.
export const requestId = honoRequestId();

// Everything after this runs inside the request's context, including the error handler.
export const requestContext = createMiddleware<{ Variables: { requestId: string } }>((c, next) =>
  runWithContext({ requestId: c.var.requestId }, next),
);

// One line per request. The route pattern, not the path, so ids and tokens stay out of logs.
// Health probes are skipped: they run every few seconds and say nothing about traffic.
export const accessLog = createMiddleware(async (c, next) => {
  if (c.req.path.startsWith("/health/")) return next();
  const start = performance.now();
  await next();
  const status = c.res.status;
  logger[status >= 500 ? "error" : "info"](
    {
      method: c.req.method,
      route: routePath(c, -1),
      status,
      durationMs: Math.round(performance.now() - start),
    },
    "request",
  );
});

// The client gets a 503 after this long, but the handler is not cancelled: it runs to completion
// in the background. Database statement timeouts are what actually stop work.
export const timeout = honoTimeout(
  15_000,
  new HTTPException(503, { message: "Request timed out." }),
);

// JSON bodies stay small. The only uploads are vehicle images (5 MB each, checked again by their route, which answers
// with its own message); their routes get room for the file plus the multipart framing.
const jsonLimit = honoBodyLimit({
  maxSize: 100 * 1024,
  onError: () => {
    throw new HTTPException(413, { message: "Request body is larger than 100 KB." });
  },
});

const uploadLimit = honoBodyLimit({
  maxSize: VEHICLE_IMAGE_MAX_BYTES + 64 * 1024,
  onError: () => {
    throw new HTTPException(413, { message: "An image can be 5 MB at most." });
  },
});

const uploadRoutes = [/^\/v1\/staff\/vehicles\/[^/]+\/images$/];

export const bodyLimit = createMiddleware((c, next) =>
  c.req.method === "POST" && uploadRoutes.some((route) => route.test(c.req.path))
    ? uploadLimit(c, next)
    : jsonLimit(c, next),
);
