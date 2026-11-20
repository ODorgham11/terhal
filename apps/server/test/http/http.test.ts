import { describe, expect, it } from "vitest";
import { routes } from "../../src/http/router";

describe("health", () => {
  it("is live and ready with Postgres and Redis up", async () => {
    expect(await (await routes.request("/health/live")).json()).toEqual({ status: "ok" });

    const ready = await routes.request("/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok", checks: { database: "ok", cache: "ok" } });
  });
});

describe("errors", () => {
  it("answers unknown routes with a problem, tagged with the request id", async () => {
    const response = await routes.request("/v1/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      status: 404,
      code: "NOT_FOUND",
      requestId: response.headers.get("X-Request-Id"),
    });
  });

  it("refuses admin requests sent from another origin", async () => {
    const response = await routes.request("/v1/admin/anything", {
      method: "POST",
      headers: { Origin: "https://terhal.co" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "UNTRUSTED_ORIGIN" });
  });
});

// The API's contract, committed as apps/server/openapi.json so every change to it shows up in review. After an
// intended change, regenerate it with `pnpm --filter @terhal/server test -u` and commit it with the change.
describe("openapi", () => {
  it("matches the committed contract", async () => {
    const document: unknown = await (await routes.request("/v1/openapi.json")).json();
    await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot(
      "../../openapi.json",
    );
  });

  it("serves the docs page outside production", async () => {
    expect((await routes.request("/v1/docs")).status).toBe(200);
  });
});
