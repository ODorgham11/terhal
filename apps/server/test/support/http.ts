import { routes } from "../../src/http/router";

export const ADMIN_ORIGIN = "https://admin.local.terhal.co:3000";
export const SITE_ORIGIN = "https://local.terhal.co:3000";

// A browser in miniature: sends one frontend's Origin (the admin panel's by default) and keeps the cookies the API
// sets, by name, like a browser would for the API's host (paths aside: each audience's cookies are under its own
// prefix, and a test calls one audience's routes).
export const createAgent = (origin = ADMIN_ORIGIN) => {
  const jar = new Map<string, string>();

  const request = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    if (jar.size > 0) {
      headers.set("Cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    if (init.json !== undefined) headers.set("Content-Type", "application/json");

    const response = await routes.request(path, {
      ...init,
      headers,
      body: init.json === undefined ? init.body : JSON.stringify(init.json),
    });

    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      const expired = attributes.some((a) => /max-age=0/i.test(a.trim()));
      if (expired || value === "") jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }

    return response;
  };

  return { request, jar };
};
