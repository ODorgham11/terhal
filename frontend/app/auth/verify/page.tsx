"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IconCircleCheck } from "@tabler/icons-react";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import FormError from "@/components/ui/form-error";

type Errors = { code?: string; form?: string };

type Verification = { destination: string; pending: boolean; resendAvailableAt: string | null };

// Confirms the code sent to a signed in, unverified user, who gets here from sign up or from signing in before verifying.
// Where the code went and when it can be resent come from the backend, so a refresh or a new tab picks up the same state.
export default function Verify() {
    const router = useRouter();
    const { setUser } = useAuth();

    const [verification, setVerification] = useState<Verification | null>(null);
    const [code, setCode] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [loading, setLoading] = useState(false);
    const [isVerified, setIsVerified] = useState(false);

    const resendAt = verification?.resendAvailableAt;

    // Ticks once a second while the resend button is cooling down, so it can count down to when it's available.
    const [now, setNow] = useState(() => Date.now());
    const resendIn = resendAt ? Math.max(0, Math.ceil((new Date(resendAt).getTime() - now) / 1000)) : 0;

    useEffect(() => {
        if (resendIn <= 0) return;
        const timeout = setTimeout(() => setNow(Date.now()), 1000);
        return () => clearTimeout(timeout);
    }, [resendIn, now]);

    // Handles the errors both actions share, and returns the ones that are specific to the action.
    const handleError = (error: ApiError["error"]) => {
        if (error.code === "ALREADY_VERIFIED") {
            setIsVerified(true);
            return null;
        }

        if (error.code && ["UNAUTHENTICATED", "INVALID_REFRESH_TOKEN"].includes(error.code)) {
            // Replace rather than push, so going back doesn't land on this page again only to be redirected.
            router.replace("/auth/sign-in");
            return null;
        }

        return error;
    };

    useEffect(() => {
        const load = async () => {
            try {
                const res = await api.auth.verification.$get();
                if (res.ok) return setVerification((await res.json()).data.verification);

                const error = handleError(((await res.json()) as unknown as ApiError).error);
                if (error) setErrors({ form: error.message });
            } catch {
                setErrors({ form: "Could not reach the server. Please check your connection and try again." });
            }
        };

        load();
        // Only on mount: handleError just redirects, so it doesn't need to re-run when it's recreated.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(code)) return setErrors({ code: "Please enter the 6-digit code." });

        setErrors({});
        setLoading(true);

        try {
            const res = await api.auth.verification.confirm.$post({ json: { code } });

            // The account is active now, so update the user everywhere before leaving.
            if (res.ok) {
                setUser((await res.json()).data.user);
                return router.push("/");
            }

            const error = handleError(((await res.json()) as unknown as ApiError).error);
            if (!error) return;

            const codeError = error.fields?.find((f) => f.field === "code")?.message;
            const aboutCode = codeError || error.code?.startsWith("VERIFICATION_CODE") || error.code === "TOO_MANY_ATTEMPTS";

            setErrors(aboutCode ? { code: codeError ?? error.message } : { form: error.message });
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    const resend = async () => {
        setErrors({});
        setLoading(true);

        try {
            const res = await api.auth.verification.send.$post();

            if (res.ok) {
                const { data } = await res.json();
                setVerification({ destination: data.verification.destination, pending: true, resendAvailableAt: data.verification.resendAvailableAt });
                setNow(Date.now());
                setCode("");
                return;
            }

            const error = handleError(((await res.json()) as unknown as ApiError).error);
            if (error) setErrors({ form: error.message });
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    // Render nothing until the backend has answered, so a signed out user goes straight to sign in
    // instead of seeing the form for a moment first. A network error still shows the form, with the error.
    if (!verification && !isVerified && !errors.form) return null;

    if (isVerified) {
        return (
            <div className="flex flex-col gap-6">
                <IconCircleCheck className="size-10 text-green-600" stroke={1.5} aria-hidden />
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">You&apos;re already verified</h1>
                    <p className="text-sm text-neutral-500">Your account has been verified, so there&apos;s nothing left to do here.</p>
                </div>
                <Button type="button" className="self-end" onClick={() => router.push("/")}>Continue</Button>
            </div>
        );
    }

    return (
        <form onSubmit={confirm} noValidate className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Verify your account</h1>
                <p className="text-sm text-neutral-500">
                    {!verification
                        ? "Enter the 6-digit code we sent you."
                        : verification.pending
                            ? `Enter the 6-digit code we sent to ${verification.destination}.`
                            : `Send a code to ${verification.destination}, then enter it below.`}
                </p>
            </div>

            <Input
                label="Verification code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                error={errors.code}
            />

            <FormError message={errors.form} />

            <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-neutral-500">
                    {verification?.pending ? "Didn't get a code? " : "No code yet? "}
                    {resendIn > 0 ? (
                        <span>Resend in {resendIn}s</span>
                    ) : (
                        <Button type="button" variant="link" disabled={loading || !verification} onClick={resend}>{verification?.pending ? "Resend" : "Send code"}</Button>
                    )}
                </p>
                <Button type="submit" loading={loading} className="ml-auto">Verify</Button>
            </div>
        </form>
    );
}
