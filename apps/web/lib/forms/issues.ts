"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

// Localized validation messages.
//
// The schemas in @terhal/contracts carry English messages, and a message set on a schema wins over any zod error map,
// so the messages can't be swapped by configuring zod. Instead, the message is rebuilt from what an issue says about
// itself: its code (too_small, invalid_format...), its numbers (minimum, maximum), its format or regex pattern, and
// the field it's on. Field names come from common.fields, the sentences from errors.validation. This covers both the
// client's own validation (lib/forms resolver) and the API's 400 VALIDATION_FAILED, whose issues carry the same code
// and path but no numbers, so they get the shorter sentence.

// The parts of a zod issue (or an API ValidationIssue) the message depends on.
export type IssueLike = {
  code: string;
  path: readonly PropertyKey[] | string;
  minimum?: unknown;
  maximum?: unknown;
  origin?: unknown;
  format?: unknown;
  pattern?: unknown;
};

// The regexes the contracts use, by their source. One not listed falls back to "{field} isn't valid.", so a new regex
// in the contracts still shows a sensible message; add it here for a precise one.
const patterns: Partial<
  Record<string, "passwordLowercase" | "passwordUppercase" | "passwordNumber" | "code" | "phone">
> = {
  "/[a-z]/": "passwordLowercase",
  "/[A-Z]/": "passwordUppercase",
  "/\\d/": "passwordNumber",
  "/^\\d{6}$/": "code",
  "/^\\+[1-9]\\d{7,14}$/": "phone",
};

type FieldName = keyof Messages["common"]["fields"];

const fieldOf = (path: IssueLike["path"]) => {
  const parts = typeof path === "string" ? path.split(".") : path;
  // The last named part: "permissions.0" is about permissions.
  return [...parts]
    .reverse()
    .find((part): part is string => typeof part === "string" && !/^\d+$/.test(part));
};

const numberOf = (value: unknown) =>
  typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : undefined;

// Returns a function that turns an issue into a sentence in the page's language.
export function useIssueMessage() {
  const t = useTranslations("errors.validation");
  const fields = useTranslations("common.fields");

  return useCallback(
    (issue: IssueLike): string => {
      const name = fieldOf(issue.path);
      const field = name && fields.has(name as FieldName) ? fields(name as FieldName) : undefined;

      const withField = (
        key: "required" | "tooShort" | "tooLong" | "invalid",
        values: { min?: number; max?: number } = {},
      ) => (field ? t(`${key}Field`, { field, ...values }) : t(key, values));

      const rule = typeof issue.pattern === "string" ? patterns[issue.pattern] : undefined;
      const min = numberOf(issue.minimum);
      const max = numberOf(issue.maximum);

      switch (issue.code) {
        case "invalid_type":
          return withField("required");
        case "too_small":
          if (issue.origin === "array" || issue.origin === "set")
            return min === undefined ? withField("invalid") : t("tooFew", { min });
          // .min(1) is how the contracts say "required" for a string.
          if (min === undefined) return withField("invalid");
          return min <= 1 ? withField("required") : withField("tooShort", { min });
        case "too_big":
          if (issue.origin === "array" || issue.origin === "set")
            return max === undefined ? withField("invalid") : t("tooMany", { max });
          return max === undefined ? withField("invalid") : withField("tooLong", { max });
        case "invalid_format":
          if (issue.format === "email") return t("email");
          if (rule) return t(rule);
          if (name === "email") return t("email");
          if (name === "phone") return t("phone");
          if (name === "code") return t("code");
          return withField("invalid");
        case "invalid_value":
        case "invalid_union":
          return t("option");
        default:
          // A confirmation that doesn't match its password (lib/forms/confirm-password).
          if (name === "confirmPassword") return t("passwordsMatch");
          // custom and anything else: the field is all we know.
          if (name === "email") return t("email");
          if (name === "phone") return t("phone");
          return withField("invalid");
      }
    },
    [t, fields],
  );
}
