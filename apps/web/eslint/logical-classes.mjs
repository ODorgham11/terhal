// Fails `pnpm lint` when a Tailwind class names a physical side (ml-4, pr-2, left-0, text-right, rounded-l, border-r...).
// Every page is laid out once for both directions, so it must use the logical ones (ms-4, pe-2, start-0, text-end,
// rounded-s, border-e), which flip with <html dir> (docs/decisions.md, "Arabic and English, right to left").
//
// It checks every string and template literal in the web app, since classes are built in cn() calls, variant maps and
// constants as often as in className. The patterns need a Tailwind shape (ml-4, not "ml"), so prose doesn't trip it.

const physical = [
  // margin, padding and scroll margin/padding on one side
  /^(?:scroll-)?[mp][lr]-/,
  // inset on one side
  /^(?:left|right)-/,
  /^text-(?:left|right)$/,
  // one side's or one corner's radius
  /^rounded-(?:[lr]|tl|tr|bl|br)(?:-|$)/,
  /^border-[lr](?:-|$)/,
  /^(?:float|clear)-(?:left|right)$/,
  // space between children, which is physical without rtl:space-x-reverse; use gap instead
  /^space-x-/,
];

const logicalFor = {
  ml: "ms",
  mr: "me",
  pl: "ps",
  pr: "pe",
  left: "start",
  right: "end",
};

// "md:hover:-ml-2!" → "ml-2": drop variants, the important marker and the negative sign.
const utilityOf = (token) => {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token[i];
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "").replace(/!$/, "").replace(/^-/, "");
};

const hint = (utility) => {
  const side = /^(?:scroll-)?(ml|mr|pl|pr|left|right)-/.exec(utility)?.[1];
  if (side) return ` Use ${utility.replace(side, logicalFor[side])} instead.`;
  if (utility.startsWith("text-"))
    return ` Use ${utility === "text-left" ? "text-start" : "text-end"} instead.`;
  if (utility.startsWith("space-x-")) return " Use gap instead.";
  return " Use the logical s/e (start/end) form instead.";
};

const check = (context, node, text) => {
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const utility = utilityOf(token);
    if (physical.some((pattern) => pattern.test(utility))) {
      context.report({
        node,
        message: `"${token}" is a physical-direction class, which breaks right-to-left layout.${hint(utility)}`,
      });
    }
  }
};

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow physical-direction Tailwind classes; use logical ones." },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string") check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

const plugin = { rules: { "logical-classes": rule } };

export default plugin;
