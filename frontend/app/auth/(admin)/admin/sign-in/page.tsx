"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { api, type ApiError } from "@/lib/api";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/ui/password";
import FormError from "@/components/ui/form-error";

type Step = "credentials" | "code";
type Errors = { email?: string; password?: string; code?: string; form?: string };

// Slides forward into the code step, and back when starting over.
const slide: Variants = {
    enter: (step: Step) => ({ opacity: 0, x: step === "code" ? 24 : -24 }),
    center: { opacity: 1, x: 0 },
    exit: (step: Step) => ({ opacity: 0, x: step === "code" ? -24 : 24 }),
};

const slideProps = { variants: slide, initial: "enter", animate: "center", exit: "exit", transition: { duration: 0.25, ease: "easeOut" } } as const;

const NETWORK_ERROR = "Could not reach the server. Please check your connection and try again.";

// Admins sign in with their password, then a code from their authenticator app. The password alone never starts a session:
// it only earns a 5-minute window to enter the code.
export default function AdminSignIn() {
    const router = useRouter();

    const [step, setStep] = useState<Step>("credentials");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [code, setCode] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [loading, setLoading] = useState(false);

    const checkPassword = async (e: FormEvent) => {
        e.preventDefault();

        const missing: Errors = {};
        if (!email.trim()) missing.email = "Email is required.";
        if (!password) missing.password = "Password is required.";
        if (Object.keys(missing).length) return setErrors(missing);

        setErrors({});
        setLoading(true);

        try {
            const res = await api.admin.auth["sign-in"].$post({ json: { email, password } });

            if (res.ok) {
                setCode("");
                return setStep("code");
            }

            const { error } = (await res.json()) as unknown as ApiError;
            const field = (name: string) => error.fields?.find((f) => f.field === name)?.message;

            setErrors(field("email") || field("password") ? { email: field("email"), password: field("password") } : { form: error.message });
        } catch {
            setErrors({ form: NETWORK_ERROR });
        } finally {
            setLoading(false);
        }
    };

    const verify = async (e: FormEvent) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(code)) return setErrors({ code: "Please enter the 6-digit code from your authenticator app." });

        setErrors({});
        setLoading(true);

        try {
            const res = await api.admin.auth.verify.$post({ json: { code } });
            if (res.ok) return router.push("/admin");

            const { error } = (await res.json()) as unknown as ApiError;

            // The 5-minute window ran out, so the password has to be entered again.
            if (error.code === "TOTP_CHALLENGE_INVALID") {
                setStep("credentials");
                setPassword("");
                return setErrors({ form: error.message });
            }

            setErrors(error.code === "TOTP_CODE_INVALID" ? { code: error.message } : { form: error.message });
        } catch {
            setErrors({ form: NETWORK_ERROR });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence mode="wait" initial={false} custom={step}>
            {step === "credentials" ? (
                <motion.form key="credentials" custom={step} {...slideProps} onSubmit={checkPassword} noValidate className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Admin sign in</h1>
                        <p className="text-sm text-neutral-500">Enter your admin email and password to continue.</p>
                    </div>

                    <Input label="Email" type="email" name="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
                    <PasswordInput label="Password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />

                    <FormError message={errors.form} />

                    <Button type="submit" loading={loading} className="self-end">Continue</Button>
                </motion.form>
            ) : (
                <motion.form key="code" custom={step} {...slideProps} onSubmit={verify} noValidate className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Two-factor authentication</h1>
                        <p className="text-sm text-neutral-500">Enter the 6-digit code from your authenticator app for {email.trim()}.</p>
                    </div>

                    <Input
                        label="Authentication code"
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

                    <div className="flex items-center justify-between gap-4">
                        <Button type="button" variant="secondary" disabled={loading} onClick={() => { setStep("credentials"); setErrors({}); }}>Back</Button>
                        <Button type="submit" loading={loading}>Sign in</Button>
                    </div>
                </motion.form>
            )}
        </AnimatePresence>
    );
}
