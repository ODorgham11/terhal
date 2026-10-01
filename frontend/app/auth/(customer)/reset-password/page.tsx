"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle } from "@tabler/icons-react";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { homePathFor } from "@/lib/routes";
import Button from "@/components/ui/button";
import PasswordInput from "@/components/ui/password";
import AppLink from "@/components/ui/link";
import FormError from "@/components/ui/form-error";

type Errors = { password?: string; form?: string };

type State =
    | { status: "loading" }
    | { status: "ready"; email: string }
    | { status: "unusable"; message: string };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Shown instead of the form when the link is expired, already used, or not a real reset link.
function ResetLinkProblem({ message }: { message: string }) {
    return (
        <div className="flex flex-col gap-6">
            <IconAlertCircle className="size-10 text-red-600" stroke={1.5} aria-hidden />
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">This link can&apos;t be used</h1>
                <p className="text-sm text-neutral-500">{message}</p>
            </div>
            <AppLink href="/auth/forgot-password" className="self-start">Request a new link</AppLink>
        </div>
    );
}

// Where the link from a password reset message lands. Choosing a new password signs the user out everywhere else
// and signs them in here.
export default function ResetPassword({ searchParams }: PageProps<"/auth/reset-password">) {
    const router = useRouter();
    const { setUser } = useAuth();
    const token = single(use(searchParams).token);

    const [state, setState] = useState<State>({ status: "loading" });
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState<Errors>({});
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Takes the token out of the address bar, so it doesn't linger in history or get shared by accident.
        if (token) window.history.replaceState(null, "", window.location.pathname);

        const load = async (): Promise<State> => {
            if (!token) return { status: "unusable", message: "This reset link is incomplete. Open the link from your message again." };

            try {
                const res = await api.auth.password.reset.$get({ query: { token } });
                if (res.ok) return { status: "ready", email: (await res.json()).data.reset.email };

                return { status: "unusable", message: ((await res.json()) as unknown as ApiError).error.message };
            } catch {
                return { status: "unusable", message: "Could not reach the server. Please check your connection and try again." };
            }
        };

        load().then(setState);
        // Only on mount: the token is read once from the link.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const reset = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;
        if (!password) return setErrors({ password: "Password is required." });

        setErrors({});
        setLoading(true);

        try {
            const res = await api.auth.password.reset.$post({ json: { token, password } });

            if (res.ok) {
                // Accounts that haven't confirmed their code yet finish that first, the same as after signing in.
                const { data } = await res.json();
                setUser(data.user);
                return router.push(data.user.status === "UNVERIFIED" ? "/auth/verify" : homePathFor(data.user.role));
            }

            const { error } = (await res.json()) as unknown as ApiError;

            // The link was used, replaced, or expired while the form was open.
            if (error.code === "PASSWORD_RESET_INVALID" || error.code === "PASSWORD_RESET_EXPIRED" || error.code === "ACCOUNT_NOT_ACTIVE") {
                return setState({ status: "unusable", message: error.message });
            }

            const field = error.fields?.find((f) => f.field === "password");
            setErrors(field ? { password: field.message } : { form: error.message });
        } catch {
            setErrors({ form: "Could not reach the server. Please check your connection and try again." });
        } finally {
            setLoading(false);
        }
    };

    // Nothing until the link is checked, so a bad link never flashes the form first.
    if (state.status === "loading") return null;
    if (state.status === "unusable") return <ResetLinkProblem message={state.message} />;

    return (
        <form onSubmit={reset} noValidate className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Choose a new password</h1>
                <p className="text-sm text-neutral-500">
                    For <span className="font-medium text-neutral-900">{state.email}</span>. You&apos;ll be signed out on your other devices.
                </p>
            </div>

            {/* Kept in the form so password managers save the new password against this email. */}
            <input type="text" name="email" autoComplete="username" value={state.email} readOnly hidden />

            <div className="flex flex-col gap-1.5">
                <PasswordInput label="New password" name="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
                {!errors.password && <p className="text-xs text-neutral-500">At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</p>}
            </div>

            <FormError message={errors.form} />

            <Button type="submit" loading={loading} className="self-end">Reset password</Button>
        </form>
    );
}
