"use client";

import { use, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/ui/password";
import FormError from "@/components/ui/form-error";
import InvitationProblem from "@/components/auth/invitation-problem";
import { useInvitation } from "@/components/auth/use-invitation";

type Field = "firstName" | "lastName" | "phone" | "password";
type Errors = Partial<Record<Field | "form", string>>;

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Where an invited staff member creates their account, from the link in their invitation email.
// The email is fixed by the invitation, and they're signed in as soon as the account is created.
export default function StaffInvite({ searchParams }: PageProps<"/auth/invite/staff">) {
    const router = useRouter();
    const { setUser } = useAuth();
    const token = single(use(searchParams).token);

    const invitation = useInvitation(token, (token) => api.staff.invitations.lookup.$get({ query: { token } }));

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [unusable, setUnusable] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const accept = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;

        const missing: Errors = {};
        if (!firstName.trim()) missing.firstName = "First name is required.";
        if (!lastName.trim()) missing.lastName = "Last name is required.";
        if (!phone.trim()) missing.phone = "Phone number is required.";
        if (!password) missing.password = "Password is required.";
        if (Object.keys(missing).length) return setErrors(missing);

        setErrors({});
        setLoading(true);

        try {
            const res = await api.staff.invitations.accept.$post({ json: { token, firstName, lastName, phone, password } });

            if (res.ok) {
                setUser((await res.json()).data.user);
                return router.push("/dashboard");
            }

            const { error } = (await res.json()) as unknown as ApiError;

            // The invitation was used, revoked, or expired while the form was open.
            if (error.code === "INVITATION_INVALID" || error.code === "INVITATION_EXPIRED") return setUnusable(error.message);

            // A field can fail several rules at once, so keep the first message for each.
            const fields: Errors = {};
            for (const f of error.fields ?? []) fields[f.field as Field] ??= f.message;
            if (error.code === "PHONE_ALREADY_IN_USE") fields.phone = error.message;

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

    return (
        <form onSubmit={accept} noValidate className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Join the Terhal team</h1>
                <p className="text-sm text-neutral-500">
                    You&apos;ve been invited as a staff member. Set up your account for <span className="font-medium text-neutral-900">{invitation.invitation.email}</span>.
                </p>
            </div>

            {/* Kept in the form so password managers save the new password against this email. */}
            <input type="text" name="email" autoComplete="username" value={invitation.invitation.email} readOnly hidden />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="First name" name="firstName" autoComplete="given-name" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} error={errors.firstName} />
                <Input label="Last name" name="lastName" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} error={errors.lastName} />
            </div>

            <Input label="Phone number" type="tel" name="phone" autoComplete="tel" placeholder="+201012345678" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />

            <div className="flex flex-col gap-1.5">
                <PasswordInput label="Password" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
                {!errors.password && <p className="text-xs text-neutral-500">At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</p>}
            </div>

            <FormError message={errors.form} />

            <Button type="submit" loading={loading} className="self-end">Create account</Button>
        </form>
    );
}
