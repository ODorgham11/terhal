// CSV for spreadsheets, written a line at a time so exports can stream: RFC 4180 quoting, CRLF line ends, and a byte
// order mark first so Excel reads the Arabic as UTF-8. Text a spreadsheet would run as a formula (starting with = + -
// @, a tab or a carriage return) gets a leading apostrophe, so a name like "=HYPERLINK(...)" stays text.
// The same rules as the price list's export (pricing/domain/csv.ts).

export const CSV_BOM = String.fromCharCode(0xfeff);

const formulaStart = /^[=+\-@\t\r]/;
// A negative amount ("-12.50") is just a number to a spreadsheet, so it's left as it is.
const negativeNumber = /^-\d+(\.\d+)?$/;

export type CsvValue = string | number | boolean | null | undefined;

export const csvCell = (value: CsvValue) => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value);
  const safe = formulaStart.test(value) && !negativeNumber.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const csvLine = (values: readonly CsvValue[]) => `${values.map(csvCell).join(",")}\r\n`;
