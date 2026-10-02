"use client";

import { useState, type FormEvent } from "react";
import { IconMailForward } from "@tabler/icons-react";
import { api, type ApiError } from "@/lib/api";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import AppLink from "@/components/ui/link";
import FormError from "@/components/ui/form-error";

type Errors = { identifier?: string; form?: string };

// Asks for the email or phone the account signs in with, and sends a reset link there.
// The backend answers the same way whether or not the account exists, so the confirmation can't say for sure that one does.
export default function ForgotPassword() {
    const [identifier, setIdentifier] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [loading, setLoading] = useState(false);
    const [sentTo, setSentTo] = useState<string | null>(null);

    const send = async (e: FormEvent) => {
        e.preventDefault();
        if (!identifier.trim()) return setErrors({ identifier: "Email or phone number is required." });

        setErrors({});
        setLoading(true);

        try {
            const res = await api.auth.password.forgot.$post({ json: { identifier } });
            if (res.ok) return setSentTo(identifier.trim());

            const { error } = (await res.json()) as unknown as ApiError;
            const field = error.fields?.find((f) => f.field === "identifier");

            setErrors(field ? { identifier: field.message } : { form: error.message });
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    if (sentTo) {
        const channel = sentTo.includes("@") ? "email" : "WhatsApp";

        return (
            <div className="flex flex-col gap-6">
                <IconMailForward className="size-10 text-neutral-900" stroke={1.5} aria-hidden />
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Check your {channel}</h1>
                    <p className="text-sm text-neutral-500">
                        If an account uses <span className="font-medium text-neutral-900">{sentTo}</span>, we&apos;ve sent it a link to choose a new password.
                        The link expires in 30 minutes.
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <Button type="button" variant="link" onClick={() => setSentTo(null)}>Use a different email or phone</Button>
                    <AppLink href="/auth/sign-in">Back to sign in</AppLink>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={send} noValidate className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Forgot your password?</h1>
                <p className="text-sm text-neutral-500">Enter the email or phone number you sign in with, and we&apos;ll send you a link to reset it.</p>
            </div>
            <Input
                label="Email or phone number"
                name="identifier"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                error={errors.identifier}
            />

            <FormError message={errors.form} />

            <div className="flex flex-wrap items-center justify-between gap-4">
                <AppLink href="/auth/sign-in">Back to sign in</AppLink>
                <Button type="submit" loading={loading} className="ml-auto">Send reset link</Button>
            </div>
        </form>
    );
}
