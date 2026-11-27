import { REPORT_LINK_VALID_DAYS, type ExpenseType, type Locale } from "@terhal/contracts";

// The driver report's rules that need no database: when a link expires, what it says on WhatsApp, and what a completed
// trip writes to the driver's ledger.

const DAY = 24 * 60 * 60 * 1000;

// D1 b: a link works until 7 days after the trip's pickup.
export const reportLinkExpiry = (pickupDate: Date) =>
  new Date(pickupDate.getTime() + REPORT_LINK_VALID_DAYS * DAY);

// What the link's token is made from: the trip, its driver and a fresh salt, so a new driver or a new link gives a new
// token and the old one stops matching.
export const reportTokenMessage = (tripId: string, driverId: string, salt: string) =>
  `${tripId}.${driverId}.${salt}`;

export const reportUrl = (siteUrl: string, token: string) => `${siteUrl}/report#${token}`;

// --- WhatsApp click-to-chat (D2 a) ---

const pickupWhen = (pickupDate: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(pickupDate);

// The sender is the trip's brand (Terhal when it has none), signed off with its phone when it has one.
export interface MessageBrand {
  nameEn: string;
  nameAr: string;
  phone: string | null;
}

const TERHAL: MessageBrand = { nameEn: "Terhal", nameAr: "ترحال", phone: null };

export const reportLinkMessage = (
  {
    firstName,
    code,
    pickupDate,
    url,
    brand,
  }: {
    firstName: string;
    code: string;
    pickupDate: Date;
    url: string;
    brand?: MessageBrand | null;
  },
  locale: Locale,
) => {
  const sender = brand ?? TERHAL;
  const name = locale === "ar" ? sender.nameAr : sender.nameEn;
  const signOff = sender.phone ? `\n— ${name} · ${sender.phone}` : "";
  return locale === "ar"
    ? `مرحبًا ${firstName}، معك ${name}. هذا رابط تقرير الرحلة ${code} (${pickupWhen(pickupDate, "ar")}). افتحه لبدء الرحلة وإنهائها ثم إرسال التقرير: ${url}${signOff}`
    : `Hi ${firstName}, this is ${name}. Here's the report link for trip ${code} (${pickupWhen(pickupDate, "en")}). Open it to start and end the trip, then send the report: ${url}${signOff}`;
};

// wa.me takes the number in international form without the plus.
export const whatsappUrl = (phone: string, message: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

// --- The driver ledger on completion (D8 a, O1 b, B8 b) ---

// Amounts are worked in whole piastres, so sums are exact.
const toPiastres = (amount: string) => Math.round(Number(amount) * 100);
const toPounds = (piastres: number) => (piastres / 100).toFixed(2);

export interface LedgerReport {
  expenses: { type: ExpenseType; amount: string }[];
  cashCollected: string;
}

export interface LedgerLine {
  type: "TRIP_FEE" | "EXPENSE_REIMBURSEMENT" | "CASH_COLLECTED";
  amount: string;
}

// What completing a trip adds to its driver's balance:
// - the driver's fee for the trip, the report's DRIVER_FEE expenses, as TRIP_FEE. Every driver is paid per trip,
//   internal or external, and nets it against the cash they hold;
// - every other expense the driver paid, reimbursed, except OFFICE_FEE, which the company pays the office (O1 b);
// - the cash the driver collected from the customer, which they now owe the company (negative).
// Zero lines are left out.
export const ledgerLines = (report: LedgerReport): LedgerLine[] => {
  const sum = (types: (type: ExpenseType) => boolean) =>
    report.expenses
      .filter((expense) => types(expense.type))
      .reduce((total, expense) => total + toPiastres(expense.amount), 0);

  const fee = sum((type) => type === "DRIVER_FEE");
  const reimbursed = sum((type) => type !== "DRIVER_FEE" && type !== "OFFICE_FEE");
  const cash = toPiastres(report.cashCollected);

  const lines: LedgerLine[] = [];
  if (fee > 0) lines.push({ type: "TRIP_FEE", amount: toPounds(fee) });
  if (reimbursed > 0) lines.push({ type: "EXPENSE_REIMBURSEMENT", amount: toPounds(reimbursed) });
  if (cash > 0) lines.push({ type: "CASH_COLLECTED", amount: toPounds(-cash) });
  return lines;
};

// The entry that cancels what a trip left on a driver's balance, as a signed amount; null when there's nothing to undo.
export const reversalOf = (balance: string) => {
  const piastres = toPiastres(balance);
  return piastres === 0 ? null : toPounds(-piastres);
};
