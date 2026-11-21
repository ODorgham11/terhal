import { beforeEach, describe, expect, it } from "vitest";
import { signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { createGovernorate, createPlace, squareAround } from "../../support/locations";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const site = createAgent(SITE_ORIGIN);

const getTree = (etag?: string) =>
  site.request("/v1/site/locations", etag ? { headers: { "If-None-Match": etag } } : {});

describe("the site's location tree", () => {
  it("lists live places only, cached for a minute and revalidated by ETag", async () => {
    const cairo = await createGovernorate("Cairo", "القاهرة", squareAround(31, 30));
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi", { radius: 4000 });

    const response = await getTree();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=600",
    );
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    const etag = response.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^".+"$/);
    expect(await response.json()).toEqual({
      data: [
        {
          id: cairo.id,
          parentId: null,
          locality: "GOVERNORATE",
          nameEn: "Cairo",
          nameAr: "القاهرة",
          center: null,
        },
        {
          id: maadi.id,
          parentId: cairo.id,
          locality: "DISTRICT",
          nameEn: "Maadi",
          nameAr: "Maadi ع",
          center: { latitude: 30, longitude: 31, radius: 4000 },
        },
      ],
      outlinesVersion: expect.any(String) as unknown,
    });

    const unchanged = await getTree(etag);
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("ETag")).toBe(etag);
    expect(await unchanged.text()).toBe("");
    expect((await getTree(`W/${etag}`)).status).toBe(304);
  });

  it("changes its ETag on any change, deletes included", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    const first = (await getTree()).headers.get("ETag") ?? "";

    await agent.request(`/v1/admin/locations/${maadi.id}?expectedCount=1`, { method: "DELETE" });
    const afterDelete = await getTree(first);
    expect(afterDelete.status).toBe(200);
    expect(((await afterDelete.json()) as { data: unknown[] }).data).toHaveLength(1);
    const second = afterDelete.headers.get("ETag") ?? "";
    expect(second).not.toBe(first);

    await agent.request(`/v1/admin/locations/${cairo.id}`, {
      method: "PATCH",
      json: { nameEn: "Greater Cairo" },
    });
    expect((await getTree(second)).status).toBe(200);
  });

  it("serves outlines for good under their version, briefly under any other", async () => {
    await createGovernorate("Cairo", "القاهرة", squareAround(31, 30));
    await createGovernorate("Giza");
    const { outlinesVersion } = (await (await getTree()).json()) as { outlinesVersion: string };

    const current = await site.request(`/v1/site/locations/outlines?v=${outlinesVersion}`);
    expect(current.status).toBe(200);
    expect(current.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const body = (await current.json()) as { data: { boundary: unknown }[]; attribution: string };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.boundary).toMatchObject({ type: "Polygon" });
    expect(body.attribution).toMatch(/geoBoundaries/);

    const stale = await site.request("/v1/site/locations/outlines?v=old");
    expect(stale.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});
