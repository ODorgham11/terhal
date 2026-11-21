// Exact money arithmetic on the decimal strings Postgres returns ("1250.00", "-3.5"), in whole piastres, so sums and
// margins never pick up floating point errors.

export const toPiastres = (value: string): bigint => {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Not an amount: ${JSON.stringify(value)}`);
  const [, sign = "", pounds = "0", fraction = ""] = match;
  const piastres = BigInt(pounds) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign === "-" ? -piastres : piastres;
};

export const formatPiastres = (piastres: bigint) => {
  const negative = piastres < 0n;
  const absolute = negative ? -piastres : piastres;
  const pounds = absolute / 100n;
  const rest = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${pounds.toString()}.${rest}`;
};

export const subtractMoney = (a: string, b: string) =>
  formatPiastres(toPiastres(a) - toPiastres(b));

// The amount per item, rounded half up to the piastre; null when there are no items.
export const averageMoney = (total: string, count: number) => {
  if (count === 0) return null;
  const piastres = toPiastres(total);
  const n = BigInt(count);
  const sign = piastres < 0n ? -1n : 1n;
  const absolute = piastres * sign;
  return formatPiastres(sign * ((absolute * 2n + n) / (2n * n)));
};

// A share from 0 to 1, to four decimals; 0 when there's nothing to share.
export const rate = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;
