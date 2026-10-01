// Joins class names, skipping the falsy ones, so conditional classes read cleanly.
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
