"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { homePathFor } from "@/lib/routes";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/ui/password";
import AppLink from "@/components/ui/link";
import FormError from "@/components/ui/form-error";

type Errors = { identifier?: string; password?: string; form?: string };
type Step = "identifier" | "password";

// Slides forward into the password step, and back out of it when going back to change the identifier.
const slide: Variants = {
    enter: (step: Step) => ({ opacity: 0, x: step === "password" ? 24 : -24 }),
    center: { opacity: 1, x: 0 },
    exit: (step: Step) => ({ opacity: 0, x: step === "password" ? -24 : 24 }),
};

const slideProps = {
    variants: slide,
    initial: "enter",
    animate: "center",
    exit: "exit",
    transition: { duration: 0.25, ease: "easeOut" },
} as const;

// Asks for the email or phone first, then the password, like the reference design.
// Both are sent together on the second step, since the backend checks them in one request.
export default function SignIn() {
    const router = useRouter();
    const { setUser } = useAuth();

    const [step, setStep] = useState<Step>("identifier");
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [loading, setLoading] = useState(false);

    const continueToPassword = (e: FormEvent) => {
        e.preventDefault();
        if (!identifier.trim()) return setErrors({ identifier: "Email or phone number is required." });

        setErrors({});
        setStep("password");
    };

    const signIn = async (e: FormEvent) => {
        e.preventDefault();
        setErrors({});
        setLoading(true);

        try {
            const res = await api.auth["sign-in"].$post({ json: { identifier, password } });
            if (res.ok) {
                // Accounts that haven't confirmed their code yet finish that first.
                const { data } = await res.json();
                setUser(data.user);
                return router.push(data.user.status === "UNVERIFIED" ? "/auth/verify" : homePathFor(data.user.role));
            }

            const { error } = (await res.json()) as unknown as ApiError;
            const fields = Object.fromEntries((error.fields ?? []).map((f) => [f.field, f.message]));

            // A bad identifier can only be fixed on the first step, so send the user back there.
            if (fields.identifier) {
                setStep("identifier");
                setErrors({ identifier: fields.identifier });
            } else {
                setErrors({ password: fields.password, form: fields.password ? undefined : error.message });
            }
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {/* The step is passed as custom so the leaving form also slides in the direction we're heading. */}
            <AnimatePresence mode="wait" initial={false} custom={step}>
                {step === "identifier" ? (
                    <motion.form key="identifier" custom={step} {...slideProps} onSubmit={continueToPassword} noValidate className="flex flex-col gap-6">
                        <div className="flex flex-col gap-1">
                            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Sign in</h1>
                            <p className="text-sm text-neutral-500">Enter your email or phone number to continue.</p>
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
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <p className="text-sm text-neutral-500">
                                Don&apos;t have an account?{" "}
                                <AppLink href="/auth/sign-up">Sign up</AppLink>
                            </p>
                            <Button type="submit" className="ml-auto">Continue</Button>
                        </div>
                    </motion.form>
                ) : (
                    <motion.form key="password" custom={step} {...slideProps} onSubmit={signIn} noValidate className="flex flex-col gap-6">
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Welcome back.</h1>
                                <p className="text-sm text-neutral-500">Enter your password to sign in to your account.</p>
                            </div>
                            <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-900">
                                <span className="truncate">{identifier}</span>
                                <Button type="button" variant="link" onClick={() => { setStep("identifier"); setErrors({}); }}>Change</Button>
                            </p>
                        </div>

                        {/* Kept in the form so password managers can pair the saved password with this account. */}
                        <input type="text" name="identifier" autoComplete="username" value={identifier} readOnly hidden />

                        <PasswordInput
                            label="Password"
                            name="password"
                            autoComplete="current-password"
                            autoFocus
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            error={errors.password}
                        />

                        <AppLink href="/auth/forgot-password" className="self-start">Forgot password?</AppLink>

                        <FormError message={errors.form} />

                        <Button type="submit" loading={loading} className="self-end">Sign in</Button>
                    </motion.form>
                )}
            </AnimatePresence>
        </>
    );
}
