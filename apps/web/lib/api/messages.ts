"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { isApiError, type ClientErrorCode } from "./errors";

// Every code has a message in messages/{ar,en}.json under errors.codes: the key below is typed from the messages, so a
// code added to @terhal/contracts without one fails the type check.
const keyOf = (code: ClientErrorCode) => `codes.${code}` as const;

// What to show for a failed request, in the page's language:
//
//   const errorMessage = useErrorMessage();
//   onError: (error) => toast.error(errorMessage(error))
//
// Anything that isn't an ApiError (a bug in the page) gets the generic message.
export function useErrorMessage() {
  const t = useTranslations("errors");

  return useCallback(
    (error: unknown) => t(keyOf(isApiError(error) ? error.code : "UNEXPECTED_RESPONSE")),
    [t],
  );
}
