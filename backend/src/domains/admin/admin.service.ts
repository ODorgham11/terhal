import { prisma } from "../../shared/utils/prisma.js";
import { compare, hash } from "../../shared/utils/hash.js";
import { decrypt, encrypt } from "../../shared/utils/encryption.js";
import { generateToken, hashToken } from "../../shared/utils/token.js";
import { createTotpSecret, getTotpUri, verifyTotp } from "../../shared/utils/totp.js";
import { BadRequestError, ConflictError, ERROR_CODES, ForbiddenError, ServiceUnavailableError, UnauthorizedError } from "../../shared/utils/error.js";
import MessagingService from "../messaging/messaging.service.js";
import TokenService from "../token/token.service.js";
import AuditService, { AUDIT_ACTIONS } from "../audit/audit.service.js";
import { AdminStatus } from "../../../generated/prisma/enums.js";
import type { Admin } from "../../../generated/prisma/client.js";
import type { AcceptAdminInvitationPayload } from "./admin.validators.js";

// The admin sending the invitation, or null when it comes from the seed.
type InviteOptions = {
    invitorId?: string | null;
    ipAddress?: string | null;
};

type RequestInfo = { ipAddress: string | null; userAgent: string | null };

export const createAdminResponse = (admin: Admin) => ({
    id: admin.id,
    firstName: admin.firstName,
    lastName: admin.lastName,
    email: admin.email,
    status: admin.status,
});

export default class AdminService {
    private readonly messagingService = new MessagingService();

    // Shorter than staff invitations, since an admin account has more power.
    private readonly INVITATION_LIFETIME = 48 * 60 * 60 * 1000;
    private readonly MAXIMUM_SESSION_LIMIT = 3;
    // Admin sessions end 12 hours after signing in no matter how often they refresh, so a stolen session can't live on.
    private readonly SESSION_ABSOLUTE_LIFETIME = 12 * 60 * 60 * 1000;

    private getFrontendUrl = () => process.env.FRONTEND_URL ?? "http://localhost:3000";

    // Emails a single-use link to create an admin account. Sending again to the same email revokes the earlier link,
    // so only the newest one works.
    inviteAdmin = async (email: string, { invitorId = null, ipAddress = null }: InviteOptions = {}) => {
        const existing = await prisma.admin.findUnique({ where: { email }, select: { id: true } });
        if (existing) throw new ConflictError("This person is already an admin.", ERROR_CODES.ACCOUNT_ALREADY_EXISTS);

        const token = generateToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.INVITATION_LIFETIME);

        const invitation = await prisma.$transaction(async (tx) => {
            await tx.adminInvitation.updateMany({
                where: { email, acceptedAt: null, revokedAt: null },
                data: { revokedAt: now },
            });

            return tx.adminInvitation.create({
                data: { email, tokenHash: hashToken(token), invitorId, expiresAt },
            });
        });

        const link = `${this.getFrontendUrl()}/auth/invite/admin?token=${token}`;

        try {
            await this.messagingService.sendInvitation(email, "admin", link, expiresAt);
        } catch (error) {
            // Nobody received this link, so make sure it can't be used.
            await prisma.adminInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });

            console.error("Failed to send admin invitation:", error);
            throw new ServiceUnavailableError("We couldn't send the invitation email. Please try again.");
        }

        // Only recorded once the email went out, since an invitation nobody received is revoked straight away.
        await AuditService.record({
            adminId: invitorId,
            action: AUDIT_ACTIONS.INVITATION_SENT,
            entityType: "AdminInvitation",
            entityId: invitation.id,
            after: { email, expiresAt: expiresAt.toISOString() },
            ipAddress,
        });

        return { email, expiresAt };
    }

    // Finds an invitation that can still be accepted, or explains why it can't.
    private findUsableInvitation = async (token: string) => {
        const invitation = await prisma.adminInvitation.findUnique({ where: { tokenHash: hashToken(token) } });

        if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
            throw new BadRequestError("This invitation link is invalid or has already been used.", ERROR_CODES.INVITATION_INVALID);
        }

        if (invitation.expiresAt <= new Date()) {
            throw new BadRequestError("This invitation has expired. Ask for a new one.", ERROR_CODES.INVITATION_EXPIRED);
        }

        return invitation;
    }

    // What the invitee sees before accepting, without using up the invitation.
    getInvitation = async (token: string) => {
        const { email, expiresAt } = await this.findUsableInvitation(token);
        return { email, expiresAt };
    }

    // Gives the invitee a two-factor secret to add to their authenticator app. The same secret comes back if they ask again
    // (e.g. after a refresh), so a code from an app they already set up keeps working.
    startTotpSetup = async (token: string) => {
        const invitation = await this.findUsableInvitation(token);

        let secret = invitation.totpSecret ? decrypt(invitation.totpSecret) : null;

        if (!secret) {
            secret = createTotpSecret();
            await prisma.adminInvitation.update({ where: { id: invitation.id }, data: { totpSecret: encrypt(secret) } });
        }

        return { uri: getTotpUri(secret, invitation.email), secret };
    }

    // Creates the admin account once they've proven their authenticator app works. The invitation is claimed in the same
    // transaction that creates the account, so a link can't be used twice even by two requests at once.
    acceptInvitation = async ({ token, code, password, ...details }: AcceptAdminInvitationPayload, ipAddress: string | null) => {
        const invitation = await this.findUsableInvitation(token);

        if (!invitation.totpSecret) throw new BadRequestError("Set up two-factor authentication before creating your account.", ERROR_CODES.TOTP_SETUP_REQUIRED);

        const step = verifyTotp(decrypt(invitation.totpSecret), code, null);
        if (step === null) throw new BadRequestError("That code didn't work. Check your authenticator app and try again.", ERROR_CODES.TOTP_CODE_INVALID);

        const existing = await prisma.admin.findUnique({ where: { email: invitation.email }, select: { id: true } });
        if (existing) throw new ConflictError("An admin account with this email already exists.", ERROR_CODES.ACCOUNT_ALREADY_EXISTS);

        const passwordHash = await hash(password);
        const now = new Date();

        const admin = await prisma.$transaction(async (tx) => {
            // Matching the secret too means a secret swapped in by another request can't be used with this code.
            const { count } = await tx.adminInvitation.updateMany({
                where: { id: invitation.id, totpSecret: invitation.totpSecret, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
                data: { acceptedAt: now, totpSecret: null },
            });

            if (count === 0) throw new BadRequestError("This invitation link is invalid or has already been used.", ERROR_CODES.INVITATION_INVALID);

            const created = await tx.admin.create({
                data: {
                    ...details,
                    email: invitation.email,
                    passwordHash,
                    totpSecret: invitation.totpSecret,
                    totpEnabledAt: now,
                    // The code used to confirm setup can't be reused to sign in.
                    totpLastUsedStep: step,
                    lastLoginAt: now,
                },
            });

            // Recorded in the same transaction, so an admin can't exist without a record of how they got in.
            await AuditService.record({
                adminId: created.id,
                action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
                entityType: "AdminInvitation",
                entityId: invitation.id,
                after: { adminId: created.id, email: created.email, invitedBy: invitation.invitorId },
                ipAddress,
            }, tx);

            await AuditService.record({ adminId: created.id, action: AUDIT_ACTIONS.TOTP_ENABLED, entityType: "Admin", entityId: created.id, ipAddress }, tx);

            return created;
        });

        return admin;
    }

    // The first half of signing in: checks the password. The caller then asks for a two-factor code (see verifySignIn).
    checkPassword = async (email: string, password: string, ipAddress: string | null) => {
        const admin = await prisma.admin.findUnique({ where: { email } });

        // Use the same error for both cases so the response doesn't reveal which accounts exist.
        // Attempts on emails that aren't admins are still recorded, since they can mean someone is guessing at accounts.
        if (!admin) {
            await AuditService.record({ adminId: null, action: AUDIT_ACTIONS.SIGN_IN_PASSWORD_FAILED, entityType: "Email", entityId: email, ipAddress });
            throw new UnauthorizedError("The email or password is incorrect.", ERROR_CODES.INVALID_CREDENTIALS);
        }

        if (!(await compare(password, admin.passwordHash))) {
            await AuditService.record({ adminId: admin.id, action: AUDIT_ACTIONS.SIGN_IN_PASSWORD_FAILED, entityType: "Admin", entityId: admin.id, ipAddress });
            throw new UnauthorizedError("The email or password is incorrect.", ERROR_CODES.INVALID_CREDENTIALS);
        }

        if (admin.status !== AdminStatus.ACTIVE) {
            await AuditService.record({ adminId: admin.id, action: AUDIT_ACTIONS.SIGN_IN_BLOCKED, entityType: "Admin", entityId: admin.id, after: { reason: "account_inactive" }, ipAddress });
            throw new ForbiddenError("This admin account is not active.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        }
        if (!admin.totpSecret) throw new ForbiddenError("Two-factor authentication isn't set up for this account.", ERROR_CODES.TOTP_SETUP_REQUIRED);

        return admin;
    }

    // The second half of signing in: checks the two-factor code for the admin who passed the password check.
    verifySignIn = async (adminId: string | null, code: string, ipAddress: string | null) => {
        if (!adminId) throw new UnauthorizedError("Your sign in has expired. Please enter your email and password again.", ERROR_CODES.TOTP_CHALLENGE_INVALID);

        const admin = await prisma.admin.findUnique({ where: { id: adminId } });

        if (!admin?.totpSecret) throw new UnauthorizedError("Your sign in has expired. Please enter your email and password again.", ERROR_CODES.TOTP_CHALLENGE_INVALID);
        if (admin.status !== AdminStatus.ACTIVE) {
            await AuditService.record({ adminId: admin.id, action: AUDIT_ACTIONS.SIGN_IN_BLOCKED, entityType: "Admin", entityId: admin.id, after: { reason: "account_inactive" }, ipAddress });
            throw new ForbiddenError("This admin account is not active.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        }

        // A wrong code after a correct password is worth recording: it can mean someone has the password but not the phone.
        const fail = async (reason: "wrong_code" | "code_reused") => {
            await AuditService.record({ adminId: admin.id, action: AUDIT_ACTIONS.SIGN_IN_TOTP_FAILED, entityType: "Admin", entityId: admin.id, after: { reason }, ipAddress });
            return new BadRequestError("That code didn't work. Check your authenticator app and try again.", ERROR_CODES.TOTP_CODE_INVALID);
        };

        const secret = decrypt(admin.totpSecret);
        const step = verifyTotp(secret, code, admin.totpLastUsedStep);

        // Checked again without the last used step, to tell a wrong code apart from a correct one being reused.
        if (step === null) throw await fail(verifyTotp(secret, code, null) === null ? "wrong_code" : "code_reused");

        // Record the step in the same statement that checks it, so two requests can't both use the same code.
        const { count } = await prisma.admin.updateMany({
            where: { id: admin.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
            data: { totpLastUsedStep: step, lastLoginAt: new Date() },
        });

        if (count === 0) throw await fail("code_reused");

        return admin;
    }

    // Starts a session for an admin who has fully signed in, keeping at most a few active at once.
    // `via` records how they got here: a new account from an invitation, or password plus two-factor code.
    createSession = async (admin: Admin, via: "invitation" | "password_and_totp", { ipAddress, userAgent }: RequestInfo) => {
        const { accessToken, refreshToken, refreshTokenHash, expiresAt: slidingExpiresAt } = await TokenService.generateTokenPair("admin", admin.id, {});
        const expiresAt = new Date(Math.min(slidingExpiresAt.getTime(), Date.now() + this.SESSION_ABSOLUTE_LIFETIME));

        const activeSessions = await prisma.adminSession.findMany({
            where: { adminId: admin.id, revokedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "asc" },
            select: { id: true },
        });

        // Revoke the oldest sessions to make way for the new one.
        const sessionsToRevoke = activeSessions.slice(0, Math.max(0, activeSessions.length - this.MAXIMUM_SESSION_LIMIT + 1));

        await prisma.$transaction(async (tx) => {
            if (sessionsToRevoke.length > 0) {
                await tx.adminSession.updateMany({
                    where: { id: { in: sessionsToRevoke.map((session) => session.id) } },
                    data: { revokedAt: new Date() },
                });

                for (const { id } of sessionsToRevoke) {
                    await AuditService.record({ adminId: admin.id, action: AUDIT_ACTIONS.SESSION_REVOKED, entityType: "AdminSession", entityId: id, after: { reason: "session_limit" }, ipAddress }, tx);
                }
            }

            const session = await tx.adminSession.create({
                data: { adminId: admin.id, refreshToken: refreshTokenHash, expiresAt, ipAddress, userAgent },
            });

            await AuditService.record({
                adminId: admin.id,
                action: AUDIT_ACTIONS.SIGN_IN_SUCCEEDED,
                entityType: "AdminSession",
                entityId: session.id,
                after: { via, userAgent, expiresAt: expiresAt.toISOString() },
                ipAddress,
            }, tx);
        });

        return { admin: createAdminResponse(admin), accessToken, refreshToken, expiresAt };
    }

    refresh = async (refreshToken: string | undefined, ipAddress: string | null, userAgent: string | null) => {
        if (!refreshToken) throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);

        // Sessions only store the hash of the refresh token, so look it up the same way.
        const currentHash = TokenService.hashRefreshToken(refreshToken);
        const session = await prisma.adminSession.findUnique({ where: { refreshToken: currentHash }, include: { admin: true } });

        if (!session) throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);

        const absoluteExpiresAt = new Date(session.createdAt.getTime() + this.SESSION_ABSOLUTE_LIFETIME);
        const now = new Date();

        if (session.revokedAt || session.expiresAt <= now || absoluteExpiresAt <= now) {
            throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);
        }

        // Check the admin again, since they may have been deactivated since signing in.
        if (session.admin.status !== AdminStatus.ACTIVE) {
            await prisma.$transaction(async (tx) => {
                await tx.adminSession.update({ where: { id: session.id }, data: { revokedAt: now } });
                await AuditService.record({ adminId: session.admin.id, action: AUDIT_ACTIONS.SESSION_REVOKED, entityType: "AdminSession", entityId: session.id, after: { reason: "account_inactive" }, ipAddress }, tx);
            });

            throw new ForbiddenError("This admin account is not active.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        }

        const { accessToken, refreshToken: newRefreshToken, refreshTokenHash, expiresAt: slidingExpiresAt } = await TokenService.generateTokenPair("admin", session.admin.id, {});

        // Never extend the session past its absolute lifetime.
        const expiresAt = slidingExpiresAt < absoluteExpiresAt ? slidingExpiresAt : absoluteExpiresAt;

        // Rotate the refresh token in place. Matching on the old hash makes sure two requests can't both use it.
        const { count } = await prisma.adminSession.updateMany({
            where: { id: session.id, refreshToken: currentHash, revokedAt: null },
            data: { refreshToken: refreshTokenHash, expiresAt, ipAddress, userAgent },
        });

        if (count === 0) throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);

        return { admin: createAdminResponse(session.admin), accessToken, refreshToken: newRefreshToken, expiresAt };
    }

    // Revokes the session behind this refresh token. Signing out always succeeds, even when the session is already gone.
    signOut = async (refreshToken: string | undefined, ipAddress: string | null) => {
        if (!refreshToken) return;

        const session = await prisma.adminSession.findUnique({ where: { refreshToken: TokenService.hashRefreshToken(refreshToken) } });
        if (!session || session.revokedAt) return;

        // Only recorded when this request is the one that ended the session.
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.adminSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
            if (count > 0) await AuditService.record({ adminId: session.adminId, action: AUDIT_ACTIONS.SIGN_OUT, entityType: "AdminSession", entityId: session.id, ipAddress }, tx);
        });
    }

    // Loads the signed in admin, checking their status since the access token can't reflect changes made after it was issued.
    getSession = async (adminId: string) => {
        const admin = await prisma.admin.findUnique({ where: { id: adminId } });

        if (!admin) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        if (admin.status !== AdminStatus.ACTIVE) throw new ForbiddenError("This admin account is not active.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);

        return createAdminResponse(admin);
    }
}
