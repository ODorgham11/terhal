"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/ui/password";
import AppLink from "@/components/ui/link";
import FormError from "@/components/ui/form-error";

const steps = ["name", "contact", "password"] as const;
type Step = (typeof steps)[number];

type Field = "firstName" | "lastName" | "email" | "phone" | "password";
type Errors = Partial<Record<Field | "form", string>>;

// Which step each field is entered on, so an error from the backend can send the user back to fix it.
const fieldSteps: Record<Field, Step> = {
    firstName: "name",
    lastName: "name",
    email: "contact",
    phone: "contact",
    password: "password",
};

// Slides forward when moving to a later step, and back when returning to an earlier one.
const slide: Variants = {
    enter: (direction: number) => ({ opacity: 0, x: direction * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (direction: number) => ({ opacity: 0, x: direction * -24 }),
};

const slideProps = {
    variants: slide,
    initial: "enter",
    animate: "center",
    exit: "exit",
    transition: { duration: 0.25, ease: "easeOut" },
} as const;

// Collects the details over three steps and creates the account on the last one, then hands off to /auth/verify.
export default function SignUp() {
    const router = useRouter();
    const { setUser } = useAuth();

    const [[step, direction], setStepState] = useState<[Step, number]>(["name", 1]);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [loading, setLoading] = useState(false);

    const goTo = (next: Step, nextErrors: Errors = {}) => {
        setStepState([next, Math.sign(steps.indexOf(next) - steps.indexOf(step)) || 1]);
        setErrors(nextErrors);
    };

    const continueToContact = (e: FormEvent) => {
        e.preventDefault();
        const missing: Errors = {};
        if (!firstName.trim()) missing.firstName = "First name is required.";
        if (!lastName.trim()) missing.lastName = "Last name is required.";
        if (Object.keys(missing).length) return setErrors(missing);

        goTo("contact");
    };

    const continueToPassword = (e: FormEvent) => {
        e.preventDefault();
        const missing: Errors = {};
        if (!email.trim()) missing.email = "Email is required.";
        if (!phone.trim()) missing.phone = "Phone number is required.";
        if (Object.keys(missing).length) return setErrors(missing);

        goTo("password");
    };

    const signUp = async (e: FormEvent) => {
        e.preventDefault();
        if (!password) return setErrors({ password: "Password is required." });

        setErrors({});
        setLoading(true);

        try {
            const res = await api.auth["sign-up"].$post({ json: { firstName, lastName, email, phone, password } });

            // The account exists (and the user is signed in) even if the first code failed to send,
            // and the verify page asks the backend whether a code is waiting or the user needs to request one.
            if (res.ok) {
                setUser((await res.json()).data.user);
                return router.push("/auth/verify");
            }

            const { error } = (await res.json()) as unknown as ApiError;
            // A field can fail several rules at once, so keep the first message for each, e.g. the length before the character rules.
            const fields: Errors = {};
            for (const f of error.fields ?? []) fields[f.field as Field] ??= f.message;

            // Conflicts come back as codes rather than field errors, so attach them to the field they're about.
            if (error.code === "EMAIL_ALREADY_IN_USE") fields.email = error.message;
            if (error.code === "PHONE_ALREADY_IN_USE") fields.phone = error.message;

            // Send the user back to the earliest step that has something to fix.
            const first = steps.find((s) => (Object.keys(fields) as Field[]).some((f) => fieldSteps[f] === s));
            if (first) return goTo(first, fields);

            setErrors({ form: error.message });
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {/* The direction is passed as custom so the leaving form also slides the way we're heading. */}
            <AnimatePresence mode="wait" initial={false} custom={direction}>
                {step === "name" && (
                    <motion.form key="name" custom={direction} {...slideProps} onSubmit={continueToContact} noValidate className="flex flex-col gap-6">
                        <Heading step={step} title="Create your account" description="Let's start with your name." />
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Input
                                label="First name"
                                name="firstName"
                                autoComplete="given-name"
                                autoFocus
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                error={errors.firstName}
                            />
                            <Input
                                label="Last name"
                                name="lastName"
                                autoComplete="family-name"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                error={errors.lastName}
                            />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <p className="text-sm text-neutral-500">
                                Already have an account?{" "}
                                <AppLink href="/auth/sign-in">Sign in</AppLink>
                            </p>
                            <Button type="submit" className="ml-auto">Continue</Button>
                        </div>
                    </motion.form>
                )}

                {step === "contact" && (
                    <motion.form key="contact" custom={direction} {...slideProps} onSubmit={continueToPassword} noValidate className="flex flex-col gap-6">
                        <Heading step={step} title="How can we reach you?" description="We'll send a code to your email to verify your account." />
                        <div className="flex flex-col gap-4">
                            <Input
                                label="Email"
                                type="email"
                                name="email"
                                autoComplete="email"
                                autoFocus
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                error={errors.email}
                            />
                            <Input
                                label="Phone number"
                                type="tel"
                                name="phone"
                                autoComplete="tel"
                                placeholder="+201012345678"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                error={errors.phone}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <Button type="button" variant="secondary" onClick={() => goTo("name")}>Back</Button>
                            <Button type="submit">Continue</Button>
                        </div>
                    </motion.form>
                )}

                {step === "password" && (
                    <motion.form key="password" custom={direction} {...slideProps} onSubmit={signUp} noValidate className="flex flex-col gap-6">
                        <Heading step={step} title="Choose a password" description="At least 8 characters, with an uppercase letter, a lowercase letter, and a number." />

                        {/* Kept in the form so password managers save the new password against this email. */}
                        <input type="text" name="email" autoComplete="username" value={email} readOnly hidden />

                        <PasswordInput
                            label="Password"
                            name="password"
                            autoComplete="new-password"
                            autoFocus
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            error={errors.password}
                        />

                        <FormError message={errors.form} />

                        <div className="flex items-center justify-between gap-4">
                            <Button type="button" variant="secondary" disabled={loading} onClick={() => goTo("contact")}>Back</Button>
                            <Button type="submit" loading={loading}>Create account</Button>
                        </div>
                    </motion.form>
                )}

            </AnimatePresence>
        </>
    );
}

// The title and description at the top of each step, with the progress above them.
function Heading({ step, title, description }: { step: Step; title: string; description: string }) {
    return (
        <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-neutral-500">Step {steps.indexOf(step) + 1} of {steps.length}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
            <p className="text-sm text-neutral-500">{description}</p>
        </div>
    );
}
