import { IconAlertCircle } from "@tabler/icons-react";
import AppLink from "@/components/ui/link";

// Shown instead of the form when an invitation link is expired, already used, or not a real invitation.
export default function InvitationProblem({ message }: { message: string }) {
    return (
        <div className="flex flex-col gap-6">
            <IconAlertCircle className="size-10 text-red-600" stroke={1.5} aria-hidden />
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">This invitation can&apos;t be used</h1>
                <p className="text-sm text-neutral-500">{message} If you still need access, ask whoever invited you to send a new invitation.</p>
            </div>
            <AppLink href="/" className="self-start">Go to the homepage</AppLink>
        </div>
    );
}
