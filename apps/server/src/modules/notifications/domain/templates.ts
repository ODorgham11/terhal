import type { Locale, NotificationKind } from "@terhal/contracts";

// Every notification's words, in Arabic and English (N5): a title (the email's subject, the inbox entry's heading), the
// plain text body, and for emails an HTML version, right to left in Arabic. Pure: the application fills in the data.

interface Names {
  en: string;
  ar: string;
}

// What the booker sees of the assignment (A6 a).
export interface AssignmentDetails {
  driverName: string | null;
  driverPhone: string | null;
  vehicle: { make: string; model: string; color: string; plate: string } | null;
  // An office trip with no driver or vehicle recorded: "operated by a partner".
  partner: boolean;
}

export interface NoticeData {
  tripId: string;
  code: string;
  // The booker's first name, for greeting them.
  name: string | null;
  // The passenger, for staff.
  client: string;
  pickupAt: string;
  pickup: Names;
  dropoff: Names;
  // Decimal string, EGP.
  price: string | null;
  reason?: string | null;
  note?: string | null;
  assignment?: AssignmentDetails | null;
  // The trip's page on the site.
  link?: string | null;
}

export interface Rendered {
  title: string;
  body: string;
  html: string;
}

const BRAND: Record<Locale, string> = { ar: "ترحال", en: "Terhal" };

// Cairo time, where the company works (X4 a).
export const formatPickup = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const formatPrice = (price: string, locale: Locale) => {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(price));
  return locale === "ar" ? `${amount} جنيه` : `EGP ${amount}`;
};

const reasons: Record<string, Names> = {
  CUSTOMER_REQUEST: { en: "at the customer's request", ar: "بناءً على طلب العميل" },
  NO_SHOW: { en: "the passenger didn't show up", ar: "لم يحضر الراكب" },
  NO_VEHICLE: { en: "no vehicle was available", ar: "لم تتوفر سيارة" },
  DUPLICATE: { en: "it was a duplicate booking", ar: "الحجز مكرر" },
  OTHER: { en: "other", ar: "سبب آخر" },
  NOT_CONFIRMED: {
    en: "it wasn't confirmed before its pickup time",
    ar: "لم يتم تأكيدها قبل موعد الانطلاق",
  },
  PRICE_NOT_SETTLED: {
    en: "its price wasn't agreed before its pickup time",
    ar: "لم يتم الاتفاق على السعر قبل موعد الانطلاق",
  },
  PRICE_DECLINED: { en: "the price was declined", ar: "تم رفض السعر" },
};

const reasonText = (reason: string | null | undefined, locale: Locale) =>
  reason ? (reasons[reason]?.[locale] ?? reason) : null;

const assignmentLines = (details: AssignmentDetails | null | undefined, locale: Locale) => {
  if (!details) return [];
  const lines: string[] = [];
  const ar = locale === "ar";
  if (details.driverName) {
    const phone = details.driverPhone
      ? ar
        ? `، ${details.driverPhone}`
        : `, ${details.driverPhone}`
      : "";
    lines.push(
      ar ? `السائق: ${details.driverName}${phone}` : `Driver: ${details.driverName}${phone}`,
    );
  }
  if (details.vehicle) {
    const { make, model, color, plate } = details.vehicle;
    lines.push(
      ar
        ? `السيارة: ${make} ${model}، ${color}، رقم اللوحة ${plate}`
        : `Car: ${make} ${model}, ${color}, plate ${plate}`,
    );
  }
  if (lines.length === 0 && details.partner) {
    lines.push(
      ar ? "تُشغَّل هذه الرحلة عبر أحد شركائنا." : "This trip is operated by one of our partners.",
    );
  }
  return lines;
};

type Text = (data: NoticeData, locale: Locale) => { title: string; lines: string[] };

const route = (data: NoticeData, locale: Locale) =>
  locale === "ar"
    ? `من ${data.pickup.ar} إلى ${data.dropoff.ar} يوم ${formatPickup(data.pickupAt, "ar")}`
    : `from ${data.pickup.en} to ${data.dropoff.en} on ${formatPickup(data.pickupAt, "en")}`;

const shortRoute = (data: NoticeData, locale: Locale) =>
  locale === "ar"
    ? `${data.client}: ${data.pickup.ar} ← ${data.dropoff.ar}، ${formatPickup(data.pickupAt, "ar")}`
    : `${data.client}: ${data.pickup.en} → ${data.dropoff.en}, ${formatPickup(data.pickupAt, "en")}`;

const greeting = (data: NoticeData, locale: Locale) =>
  data.name
    ? locale === "ar"
      ? `مرحبًا ${data.name}،`
      : `Hi ${data.name},`
    : locale === "ar"
      ? "مرحبًا،"
      : "Hi,";

const noteLine = (data: NoticeData, locale: Locale) =>
  data.note ? [locale === "ar" ? `ملاحظة: ${data.note}` : `Note: ${data.note}`] : [];

const linkLine = (data: NoticeData, locale: Locale) =>
  data.link ? [locale === "ar" ? `تفاصيل الرحلة: ${data.link}` : `Trip details: ${data.link}`] : [];

const price = (data: NoticeData, locale: Locale) =>
  data.price ? formatPrice(data.price, locale) : "";

const templates: Record<NotificationKind, Text> = {
  BOOKING_RECEIVED: (data, locale) =>
    locale === "ar"
      ? {
          title: `استلمنا حجزك ${data.code}`,
          lines: [
            greeting(data, locale),
            `استلمنا طلب رحلتك ${route(data, locale)}.`,
            data.price === null
              ? "سنرسل لك السعر قريبًا لتوافق عليه."
              : "سنراسلك فور تأكيد الرحلة.",
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `We received your booking ${data.code}`,
          lines: [
            greeting(data, locale),
            `We received your trip ${route(data, locale)}.`,
            data.price === null
              ? "We'll send you its price shortly for you to accept."
              : "We'll email you once it's confirmed.",
            ...linkLine(data, locale),
          ],
        },
  BOOKED_BY_STAFF: (data, locale) =>
    locale === "ar"
      ? {
          title: `تم حجز رحلتك ${data.code}`,
          lines: [
            greeting(data, locale),
            `حجز لك فريقنا رحلة ${route(data, locale)}.`,
            "سنراسلك فور تأكيدها.",
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `Your trip ${data.code} is booked`,
          lines: [
            greeting(data, locale),
            `Our team booked a trip for you ${route(data, locale)}.`,
            "We'll email you once it's confirmed.",
            ...linkLine(data, locale),
          ],
        },
  TRIP_CONFIRMED: (data, locale) => {
    const details = assignmentLines(data.assignment, locale);
    return locale === "ar"
      ? {
          title: `تم تأكيد رحلتك ${data.code}`,
          lines: [
            greeting(data, locale),
            `تم تأكيد رحلتك ${route(data, locale)}.`,
            ...(details.length > 0 ? details : ["سنرسل لك بيانات السائق والسيارة فور تعيينهما."]),
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `Your trip ${data.code} is confirmed`,
          lines: [
            greeting(data, locale),
            `Your trip ${route(data, locale)} is confirmed.`,
            ...(details.length > 0
              ? details
              : ["We'll send you the driver's and the car's details once they're assigned."]),
            ...linkLine(data, locale),
          ],
        };
  },
  DRIVER_ASSIGNED: (data, locale) =>
    locale === "ar"
      ? {
          title: `بيانات السائق لرحلتك ${data.code}`,
          lines: [
            greeting(data, locale),
            `هذه بيانات رحلتك ${route(data, locale)}:`,
            ...assignmentLines(data.assignment, locale),
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `Your driver for trip ${data.code}`,
          lines: [
            greeting(data, locale),
            `Here are the details for your trip ${route(data, locale)}:`,
            ...assignmentLines(data.assignment, locale),
            ...linkLine(data, locale),
          ],
        },
  TRIP_REMINDER: (data, locale) =>
    locale === "ar"
      ? {
          title: `تذكير: رحلتك ${data.code} غدًا`,
          lines: [
            greeting(data, locale),
            `نذكّرك برحلتك ${route(data, locale)}.`,
            ...assignmentLines(data.assignment, locale),
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `Reminder: your trip ${data.code} is tomorrow`,
          lines: [
            greeting(data, locale),
            `A reminder of your trip ${route(data, locale)}.`,
            ...assignmentLines(data.assignment, locale),
            ...linkLine(data, locale),
          ],
        },
  PRICE_PROPOSED: (data, locale) =>
    locale === "ar"
      ? {
          title: `سعر رحلتك ${data.code}`,
          lines: [
            greeting(data, locale),
            `حددنا سعر رحلتك ${route(data, locale)} بمبلغ ${price(data, locale)}.`,
            ...noteLine(data, locale),
            "وافق عليه من صفحة الرحلة لنكمل الحجز.",
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `A price for your trip ${data.code}`,
          lines: [
            greeting(data, locale),
            `We've priced your trip ${route(data, locale)} at ${price(data, locale)}.`,
            ...noteLine(data, locale),
            "Accept it on the trip's page to go ahead.",
            ...linkLine(data, locale),
          ],
        },
  PRICE_REMINDER: (data, locale) =>
    locale === "ar"
      ? {
          title: `رحلتك ${data.code} في انتظار موافقتك`,
          lines: [
            greeting(data, locale),
            `ما زال سعر ${price(data, locale)} لرحلتك ${route(data, locale)} في انتظار موافقتك.`,
            "إن لم توافق عليه، تُلغى الرحلة في موعد انطلاقها.",
            ...linkLine(data, locale),
          ],
        }
      : {
          title: `Your trip ${data.code} is waiting for your answer`,
          lines: [
            greeting(data, locale),
            `The price of ${price(data, locale)} for your trip ${route(data, locale)} is still waiting for you to accept it.`,
            "Without an answer, the trip is cancelled at its pickup time.",
            ...linkLine(data, locale),
          ],
        },
  TRIP_CANCELLED: (data, locale) => {
    const reason = reasonText(data.reason, locale);
    return locale === "ar"
      ? {
          title: `تم إلغاء رحلتك ${data.code}`,
          lines: [
            greeting(data, locale),
            `تم إلغاء رحلتك ${route(data, locale)}.`,
            ...(reason ? [`السبب: ${reason}.`] : []),
            ...noteLine(data, locale),
            "تواصل معنا إن كان لديك أي استفسار.",
          ],
        }
      : {
          title: `Your trip ${data.code} was cancelled`,
          lines: [
            greeting(data, locale),
            `Your trip ${route(data, locale)} was cancelled.`,
            ...(reason ? [`Reason: ${reason}.`] : []),
            ...noteLine(data, locale),
            "Contact us if you have any questions.",
          ],
        };
  },
  CANCELLATION_RECEIPT: (data, locale) =>
    locale === "ar"
      ? {
          title: `ألغيت رحلتك ${data.code}`,
          lines: [
            greeting(data, locale),
            `بناءً على طلبك، تم إلغاء رحلتك ${route(data, locale)}.`,
            "نتمنى أن نراك في رحلة قادمة.",
          ],
        }
      : {
          title: `You cancelled trip ${data.code}`,
          lines: [
            greeting(data, locale),
            `As you asked, your trip ${route(data, locale)} is cancelled.`,
            "We hope to see you on another trip.",
          ],
        },
  TRIP_COMPLETED: (data, locale) =>
    locale === "ar"
      ? {
          title: `شكرًا لسفرك مع ${BRAND.ar}`,
          lines: [
            greeting(data, locale),
            `اكتملت رحلتك ${data.code}. شكرًا لاختيارك ${BRAND.ar}، ونتمنى أن نراك مجددًا.`,
          ],
        }
      : {
          title: `Thank you for travelling with ${BRAND.en}`,
          lines: [
            greeting(data, locale),
            `Your trip ${data.code} is complete. Thank you for choosing ${BRAND.en}; we hope to see you again.`,
          ],
        },

  NEW_BOOKING: (data, locale) =>
    locale === "ar"
      ? { title: `حجز جديد ${data.code}`, lines: [shortRoute(data, locale)] }
      : { title: `New booking ${data.code}`, lines: [shortRoute(data, locale)] },
  PRICE_REQUESTED: (data, locale) =>
    locale === "ar"
      ? { title: `مطلوب سعر للرحلة ${data.code}`, lines: [shortRoute(data, locale)] }
      : { title: `Price requested for ${data.code}`, lines: [shortRoute(data, locale)] },
  PRICE_ACCEPTED: (data, locale) =>
    locale === "ar"
      ? {
          title: `تمت الموافقة على سعر الرحلة ${data.code}`,
          lines: [`${price(data, locale)}. ${shortRoute(data, locale)}`, "يمكن تأكيد الرحلة الآن."],
        }
      : {
          title: `Price accepted for ${data.code}`,
          lines: [
            `${price(data, locale)}. ${shortRoute(data, locale)}`,
            "The trip can be confirmed now.",
          ],
        },
  PRICE_DECLINED: (data, locale) =>
    locale === "ar"
      ? {
          title: `رُفض سعر الرحلة ${data.code}`,
          lines: [shortRoute(data, locale), "تم إلغاء الرحلة.", ...noteLine(data, locale)],
        }
      : {
          title: `Price declined for ${data.code}`,
          lines: [shortRoute(data, locale), "The trip is cancelled.", ...noteLine(data, locale)],
        },
  CANCELLED_BY_BOOKER: (data, locale) =>
    locale === "ar"
      ? {
          title: `ألغى العميل الرحلة ${data.code}`,
          lines: [shortRoute(data, locale), ...noteLine(data, locale)],
        }
      : {
          title: `${data.code} cancelled by the customer`,
          lines: [shortRoute(data, locale), ...noteLine(data, locale)],
        },
  CANCELLED_BY_SYSTEM: (data, locale) => {
    const reason = reasonText(data.reason, locale);
    return locale === "ar"
      ? {
          title: `أُلغيت الرحلة ${data.code} تلقائيًا`,
          lines: [shortRoute(data, locale), ...(reason ? [`السبب: ${reason}.`] : [])],
        }
      : {
          title: `${data.code} was cancelled automatically`,
          lines: [shortRoute(data, locale), ...(reason ? [`Reason: ${reason}.`] : [])],
        };
  },
  TRIP_UNASSIGNED: (data, locale) =>
    locale === "ar"
      ? {
          title: `الرحلة ${data.code} تنطلق قريبًا دون سائق`,
          lines: [shortRoute(data, locale), "عيّن سائقًا وسيارة أو مكتبًا."],
        }
      : {
          title: `${data.code} picks up soon with no driver`,
          lines: [shortRoute(data, locale), "Assign a driver and a vehicle, or an office."],
        },
  REPORT_SUBMITTED: (data, locale) =>
    locale === "ar"
      ? {
          title: `وصل تقرير الرحلة ${data.code}`,
          lines: [shortRoute(data, locale), "راجع التقرير ثم أكمل الرحلة."],
        }
      : {
          title: `Report submitted for ${data.code}`,
          lines: [shortRoute(data, locale), "Review it, then complete the trip."],
        },
};

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Trip codes, phone numbers and links keep left to right inside Arabic text.
const isolateLtr = (html: string) =>
  html.replace(/(https?:\/\/\S+|\+?\d[\d ]{6,}\d|\bTRH-[0-9A-Z]+)/g, '<bdi dir="ltr">$1</bdi>');

const toHtml = (title: string, lines: string[], locale: Locale) => {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const align = locale === "ar" ? "right" : "left";
  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 12px">${isolateLtr(escape(line))}</p>`)
    .join("");
  return [
    `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8">`,
    `<title>${escape(title)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#f6f6f6;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif">`,
    `<div dir="${dir}" style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:8px;text-align:${align};color:#1a1a1a;line-height:1.6">`,
    `<p style="margin:0 0 16px;font-weight:600">${BRAND[locale]}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px">${isolateLtr(escape(title))}</h1>`,
    paragraphs,
    `</div></body></html>`,
  ].join("");
};

export const renderNotification = (
  kind: NotificationKind,
  locale: Locale,
  data: NoticeData,
): Rendered => {
  const { title, lines } = templates[kind](data, locale);
  return { title, body: lines.join("\n"), html: toHtml(title, lines, locale) };
};
