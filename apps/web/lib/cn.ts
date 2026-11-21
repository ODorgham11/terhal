import { twMerge } from "tailwind-merge";

// Joins class names, skipping the falsy ones, and lets a later class win over an earlier one that sets the same thing
// (a page's className="w-auto" over a component's w-full), which plain joining can't promise: Tailwind orders its CSS
// by utility, not by the order classes are written in.
export const cn = (...classes: (string | false | null | undefined)[]) => twMerge(classes);
