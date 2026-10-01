// Invites the first staff member and the first admin by email. Run with `npm run db:seed`.
// No names or passwords live in the environment: each person gets a single-use link and sets up their own account.
// Running it again sends a fresh link and revokes the old one, unless the account already exists.
import "dotenv/config";
import { prisma } from "../src/shared/utils/prisma.js";
import { ConflictError } from "../src/shared/utils/error.js";
import { signUpSchema } from "../src/domains/auth/auth.validators.js";
import StaffService from "../src/domains/staff/staff.service.js";
import AdminService from "../src/domains/admin/admin.service.js";

const staffService = new StaffService();
const adminService = new AdminService();

// Reads and normalizes an email variable the same way sign up does, or returns null when it isn't set.
const readEmail = (variable: string) => {
    const value = process.env[variable]?.trim();
    if (!value) return null;

    const result = signUpSchema.shape.email.safeParse(value);
    if (!result.success) throw new Error(`${variable}: ${result.error.issues[0].message}`);

    return result.data;
};

const invite = async (label: string, variable: string, send: (email: string) => Promise<{ email: string; expiresAt: Date }>) => {
    const email = readEmail(variable);
    if (!email) return console.log(`${label}: ${variable} isn't set, skipping.`);

    try {
        const { expiresAt } = await send(email);
        console.log(`${label}: invitation sent to ${email}, valid until ${expiresAt.toUTCString()}.`);
    } catch (error) {
        // An existing account isn't a failure: there's simply nobody left to invite.
        if (error instanceof ConflictError) return console.log(`${label}: ${error.message} Skipping.`);
        throw error;
    }
};

// Runs both even if the first fails, so one problem doesn't hide another.
const main = async () => {
    const results = await Promise.allSettled([
        // The first staff member gets full access, so they can invite the rest of the team.
        invite("Staff", "STAFF_EMAIL", (email) => staffService.inviteStaff(email, { permissions: ["*"] })),
        invite("Admin", "ADMIN_EMAIL", (email) => adminService.inviteAdmin(email)),
    ]);

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    for (const { reason } of failures) console.error(reason instanceof Error ? reason.message : reason);
    if (failures.length) process.exitCode = 1;
};

main().finally(() => prisma.$disconnect());
