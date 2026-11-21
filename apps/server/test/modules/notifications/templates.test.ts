import { notificationKinds } from "@terhal/contracts";
import { describe, expect, it } from "vitest";
import {
  formatPickup,
  renderNotification,
  type NoticeData,
} from "../../../src/modules/notifications/domain/templates";

const data: NoticeData = {
  tripId: "trip1",
  code: "TRH-ABC234",
  name: "Mona",
  client: "Mona Adel",
  pickupAt: "2026-12-01T08:30:00.000Z",
  pickup: { en: "Degla", ar: "دجلة" },
  dropoff: { en: "Smouha", ar: "سموحة" },
  price: "1500.00",
  reason: "NO_VEHICLE",
  note: null,
  assignment: {
    driverName: "Ahmed",
    driverPhone: "+201220000001",
    vehicle: { make: "Toyota", model: "Corolla", color: "White", plate: "ABC 123" },
    partner: false,
  },
  link: "https://local.terhal.co:3000/trips/trip1",
};

describe("notification templates (N5)", () => {
  it("write every kind in both languages", () => {
    for (const kind of notificationKinds) {
      const en = renderNotification(kind, "en", data);
      const ar = renderNotification(kind, "ar", data);
      expect(`${en.title}\n${en.body}`).toContain("TRH-ABC234");
      expect(ar.title.length).toBeGreaterThan(0);
      expect(ar.title).not.toBe(en.title);
      expect(ar.body).toMatch(/[؀-ۿ]/);
      expect(en.body).not.toMatch(/[؀-ۿ]/);
    }
  });

  it("render Arabic right to left, with Arabic place names and the code kept left to right", () => {
    const { title, body, html } = renderNotification("TRIP_CONFIRMED", "ar", data);
    expect(title).toBe("تم تأكيد رحلتك TRH-ABC234");
    expect(body).toContain("من دجلة إلى سموحة");
    expect(body).toContain("السائق: Ahmed، +201220000001");
    expect(body).toContain("رقم اللوحة ABC 123");
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('<bdi dir="ltr">TRH-ABC234</bdi>');
  });

  it("render English left to right, in Cairo time", () => {
    const { body, html } = renderNotification("TRIP_CONFIRMED", "en", data);
    expect(body).toContain("from Degla to Smouha on Tuesday, 1 December 2026");
    // 08:30 UTC is 10:30 in Cairo.
    expect(body).toMatch(/10:30/);
    expect(body).toContain("Car: Toyota Corolla, White, plate ABC 123");
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(formatPickup(data.pickupAt, "ar")).toMatch(/[٠-٩]/);
  });

  it("give a cancellation's reason, and a partner instead of a driver when none is recorded", () => {
    expect(renderNotification("TRIP_CANCELLED", "en", data).body).toContain(
      "Reason: no vehicle was available.",
    );
    expect(renderNotification("TRIP_CANCELLED", "ar", data).body).toContain(
      "السبب: لم تتوفر سيارة.",
    );
    const partner = {
      ...data,
      assignment: { driverName: null, driverPhone: null, vehicle: null, partner: true },
    };
    expect(renderNotification("DRIVER_ASSIGNED", "en", partner).body).toContain(
      "operated by one of our partners",
    );
  });

  it("escape what people typed into the HTML", () => {
    const { html } = renderNotification("CANCELLED_BY_BOOKER", "en", {
      ...data,
      note: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
