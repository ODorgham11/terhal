// Search text, normalized the way the database's search_normalize() does (the locations migration), so what people type
// matches the stored search columns: lower case, Arabic diacritics and tatweel removed, alef forms (أ إ آ ٱ) folded to
// ا, ة to ه, ى to ي, Arabic digits to Western ones, spaces collapsed. "الإسكندرية" then matches "الاسكندريه". A server
// test keeps the two in step.

const diacritics = /[ً-ْٰـ]/g;

const folds: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ة: "ه",
  ى: "ي",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const foldable = new RegExp(`[${Object.keys(folds).join("")}]`, "g");

export const normalizeSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(diacritics, "")
    .replace(foldable, (character) => folds[character] ?? character)
    .replace(/\s+/g, " ")
    .trim();
