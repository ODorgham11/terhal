"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { Field } from "@/components/ui/Field";
import { useErrorMessage } from "@/lib/api";

type Props = { submitLabel: string; onSubmit: (code: string) => Promise<void> };

// Six digits from the authenticator app, sent as soon as the last one is typed.
export function CodeStep({ submitLabel, onSubmit }: Props) {
  const t = useTranslations("admin.auth");
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (value: string) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (failure) {
      setError(errorMessage(failure));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="danger" title={error} />}
      <Field label={t("code")} hint={t("codeHint")}>
        <CodeInput
          value={code}
          onChange={setCode}
          onComplete={(value) => void send(value)}
          autoFocus
          disabled={busy}
        />
      </Field>
      <Button
        className="w-full"
        loading={busy}
        disabled={code.length !== 6}
        onClick={() => void send(code)}
      >
        {submitLabel}
      </Button>
    </div>
  );
}
