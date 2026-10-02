"use client";

import { use, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { api, type ApiError } from "@/lib/api";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/ui/password";
import FormError from "@/components/ui/form-error";
import InvitationProblem from "@/components/auth/invitation-problem";
import { useInvitation } from "@/components/auth/use-invitation";

type Step = "details" | "two-factor";
type Field = "firstName" | "lastName" | "password" | "code";
type Errors = Partial<Record<Field | "form", string>>;
type Totp = { uri: string; secret: string };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Slides forward into the two-factor step, and back when returning to the details.
const slide: Variants = {
    enter: (step: Step) => ({ opacity: 0, x: step === "two-factor" ? 24 : -24 }),
    center: { opacity: 1, x: 0 },
    exit: (step: Step) => ({ opacity: 0, x: step === "two-factor" ? -24 : 24 }),
};

const slideProps = { variants: slide, initial: "enter", animate: "center", exit: "exit", transition: { duration: 0.25, ease: "easeOut" } } as const;

const NETWORK_ERROR = "Could not reach the server. Please check your connection and try again.";

// Where an invited admin creates their account. After their details, they add Terhal to an authenticator app and confirm
// a code, since every admin account requires two-factor authentication. The account only exists once that code checks out.
export default function AdminInvite({ searchParams }: PageProps<"/auth/invite/admin">) {
    const router = useRouter();
    const token = single(use(searchParams).token);

    const invitation = useInvitation(token, (token) => api.admin.invitations.lookup.$get({ query: { token } }));

    const [step, setStep] = useState<Step>("details");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [password, setPassword] = useState("");
    const [totp, setTotp] = useState<Totp | null>(null);
    const [code, setCode] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [unusable, setUnusable] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Errors about the invitation itself replace the whole page, since nothing on it can fix them.
    const isInvitationError = (error: ApiError["error"]) => {
        if (error.code !== "INVITATION_INVALID" && error.code !== "INVITATION_EXPIRED") return false;
        setUnusable(error.message);
        return true;
    };

    const continueToTwoFactor = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;

        const missing: Errors = {};
        if (!firstName.trim()) missing.firstName = "First name is required.";
        if (!lastName.trim()) missing.lastName = "Last name is required.";
        if (!password) missing.password = "Password is required.";
        if (Object.keys(missing).length) return setErrors(missing);

        setErrors({});

        // The secret only needs fetching once. Asking again returns the same one anyway.
        if (totp) return setStep("two-factor");

        setLoading(true);

        try {
            const res = await api.admin.invitations.totp.$post({ json: { token } });

            if (res.ok) {
                setTotp((await res.json()).data.totp);
                return setStep("two-factor");
            }

            const { error } = (await res.json()) as unknown as ApiError;
            if (!isInvitationError(error)) setErrors({ form: error.message });
        } catch {
            setErrors({ form: NETWORK_ERROR });
        } finally {
            setLoading(false);
        }
    };

    const accept = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;
        if (!/^\d{6}$/.test(code)) return setErrors({ code: "Please enter the 6-digit code from your authenticator app." });

        setErrors({});
        setLoading(true);

        try {
            const res = await api.admin.invitations.accept.$post({ json: { token, firstName, lastName, password, code } });
            if (res.ok) return router.push("/admin");

            const { error } = (await res.json()) as unknown as ApiError;
            if (isInvitationError(error)) return;

            // A field can fail several rules at once, so keep the first message for each.
            const fields: Errors = {};
            for (const f of error.fields ?? []) fields[f.field as Field] ??= f.message;
            if (error.code === "TOTP_CODE_INVALID") fields.code = error.message;

            // Name or password problems can only be fixed on the first step.
            if (fields.firstName || fields.lastName || fields.password) {
                setStep("details");
                return setErrors({ firstName: fields.firstName, lastName: fields.lastName, password: fields.password });
            }

            setErrors(Object.keys(fields).length ? fields : { form: error.message });
        } catch {
            setErrors({ form: NETWORK_ERROR });
        } finally {
            setLoading(false);
        }
    };

    // Nothing until the invitation is checked, so a bad link never flashes the form first.
    if (invitation.status === "loading") return null;
    if (invitation.status === "unusable") return <InvitationProblem message={invitation.message} />;
    if (unusable) return <InvitationProblem message={unusable} />;

    const { email } = invitation.invitation;

    return (
        <AnimatePresence mode="wait" initial={false} custom={step}>
            {step === "details" ? (
                <motion.form key="details" custom={step} {...slideProps} onSubmit={continueToTwoFactor} noValidate className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-neutral-500">Step 1 of 2</p>
                        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Set up your admin account</h1>
                        <p className="text-sm text-neutral-500">
                            You&apos;ve been invited as an admin. Set up your account for <span className="font-medium text-neutral-900">{email}</span>.
                        </p>
                    </div>

                    {/* Kept in the form so password managers save the new password against this email. */}
                    <input type="text" name="email" autoComplete="username" value={email} readOnly hidden />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Input label="First name" name="firstName" autoComplete="given-name" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} error={errors.firstName} />
                        <Input label="Last name" name="lastName" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} error={errors.lastName} />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <PasswordInput label="Password" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
                        {!errors.password && <p className="text-xs text-neutral-500">At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</p>}
                    </div>

                    <FormError message={errors.form} />

                    <Button type="submit" loading={loading} className="self-end">Continue</Button>
                </motion.form>
            ) : (
                <motion.form key="two-factor" custom={step} {...slideProps} onSubmit={accept} noValidate className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-neutral-500">Step 2 of 2</p>
                        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Turn on two-factor authentication</h1>
                        <p className="text-sm text-neutral-500">
                            Scan this code with an authenticator app like Google Authenticator or 1Password, then enter the 6-digit code it shows.
                        </p>
                    </div>

                    {totp && (
                        <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 p-6 sm:flex-row sm:items-start">
                            <QRCodeSVG value={totp.uri} size={152} marginSize={0} title="Two-factor setup QR code" className="shrink-0" />
                            <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                                <p className="text-neutral-500">Can&apos;t scan it? Enter this key in your app instead:</p>
                                <code className="break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-xs tracking-wider text-neutral-900 select-all">
                                    {totp.secret.match(/.{1,4}/g)?.join(" ")}
                                </code>
                            </div>
                        </div>
                    )}

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
                        <Button type="button" variant="secondary" disabled={loading} onClick={() => { setStep("details"); setErrors({}); }}>Back</Button>
                        <Button type="submit" loading={loading}>Create admin account</Button>
                    </div>
                </motion.form>
            )}
        </AnimatePresence>
    );
}
