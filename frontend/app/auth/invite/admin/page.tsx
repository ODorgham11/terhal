"use client";

import { use, useState, type FormEvent } from "react";
import { IconCircleCheck } from "@tabler/icons-react";
import { api, type ApiError } from "@/lib/api";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/ui/password";
import FormError from "@/components/ui/form-error";
import InvitationProblem from "../invitation-problem";
import { useInvitation } from "../use-invitation";

type Field = "firstName" | "lastName" | "password";
type Errors = Partial<Record<Field | "form", string>>;

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Where an invited admin creates their account, from the link in their invitation email.
// Admin sign in doesn't exist yet, so this ends on a confirmation instead of signing them in.
export default function AdminInvite({ searchParams }: PageProps<"/auth/invite/admin">) {
    const token = single(use(searchParams).token);

    const invitation = useInvitation(token, (token) => api.admin.invitations.lookup.$post({ json: { token } }));

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [unusable, setUnusable] = useState<string | null>(null);
    const [created, setCreated] = useState(false);
    const [loading, setLoading] = useState(false);

    const accept = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;

        const missing: Errors = {};
        if (!firstName.trim()) missing.firstName = "First name is required.";
        if (!lastName.trim()) missing.lastName = "Last name is required.";
        if (!password) missing.password = "Password is required.";
        if (Object.keys(missing).length) return setErrors(missing);

        setErrors({});
        setLoading(true);

        try {
            const res = await api.admin.invitations.accept.$post({ json: { token, firstName, lastName, password } });
            if (res.ok) return setCreated(true);

            const { error } = (await res.json()) as unknown as ApiError;

            // The invitation was used, revoked, or expired while the form was open.
            if (error.code === "INVITATION_INVALID" || error.code === "INVITATION_EXPIRED") return setUnusable(error.message);

            // A field can fail several rules at once, so keep the first message for each.
            const fields: Errors = {};
            for (const f of error.fields ?? []) fields[f.field as Field] ??= f.message;

            setErrors(Object.keys(fields).length ? fields : { form: error.message });
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    // Nothing until the invitation is checked, so a bad link never flashes the form first.
    if (invitation.status === "loading") return null;
    if (invitation.status === "unusable") return <InvitationProblem message={invitation.message} />;
    if (unusable) return <InvitationProblem message={unusable} />;

    if (created) {
        return (
            <div className="flex flex-col gap-6">
                <IconCircleCheck className="size-10 text-green-600" stroke={1.5} aria-hidden />
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Your admin account is ready</h1>
                    <p className="text-sm text-neutral-500">
                        {invitation.invitation.email} is set up as an admin. You&apos;ll be able to sign in once the admin dashboard is available.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={accept} noValidate className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Set up your admin account</h1>
                <p className="text-sm text-neutral-500">
                    You&apos;ve been invited as an admin. Set up your account for <span className="font-medium text-neutral-900">{invitation.invitation.email}</span>.
                </p>
            </div>

            {/* Kept in the form so password managers save the new password against this email. */}
            <input type="text" name="email" autoComplete="username" value={invitation.invitation.email} readOnly hidden />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="First name" name="firstName" autoComplete="given-name" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} error={errors.firstName} />
                <Input label="Last name" name="lastName" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} error={errors.lastName} />
            </div>

            <div className="flex flex-col gap-1.5">
                <PasswordInput label="Password" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
                {!errors.password && <p className="text-xs text-neutral-500">At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</p>}
            </div>

            <FormError message={errors.form} />

            <Button type="submit" loading={loading} className="self-end">Create admin account</Button>
        </form>
    );
}
