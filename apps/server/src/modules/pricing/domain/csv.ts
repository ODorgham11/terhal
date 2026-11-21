// CSV for spreadsheets: RFC 4180 quoting, CRLF line ends, and a byte order mark so Excel reads the Arabic as UTF-8.
// Text that a spreadsheet would run as a formula (starting with = + - @, a tab or a carriage return) gets a leading
// apostrophe, so a place named "=HYPERLINK(...)" stays text.

const BOM = String.fromCharCode(0xfeff);
const formulaStart = /^[=+\-@\t\r]/;

const cell = (value: string) => {
  const safe = formulaStart.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  `${BOM}${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
