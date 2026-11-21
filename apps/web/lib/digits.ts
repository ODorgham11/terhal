// Arabic keyboards type Arabic-Indic digits (٠١٢…) and Persian keyboards Eastern ones (۰۱۲…). The API only takes 0-9,
// so codes and phone numbers are converted as they're typed.
export const toLatinDigits = (value: string) =>
  value.replace(/[٠-٩۰-۹]/g, (digit) => String((digit.codePointAt(0) ?? 0) & 0xf));
