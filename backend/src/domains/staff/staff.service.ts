import { prisma } from "../../shared/utils/prisma.js";
import { hash } from "../../shared/utils/hash.js";
import { generateToken, hashToken } from "../../shared/utils/token.js";
import { BadRequestError, ConflictError, ERROR_CODES, ForbiddenError, ServiceUnavailableError } from "../../shared/utils/error.js";
import { createUserResponse } from "../auth/auth.validators.js";
import MessagingService from "../messaging/messaging.service.js";
import { UserRole, UserStatus, VerificationMethod } from "../../../generated/prisma/enums.js";
import type { AcceptStaffInvitationPayload } from "./staff.validators.js";

// The staff member sending the invitation, or null when it comes from the seed.
type InviteOptions = {
    invitorId?: string | null;
    permissions?: string[];
};

export default class StaffService {
    private readonly messagingService = new MessagingService();

    private readonly INVITATION_LIFETIME = 7 * 24 * 60 * 60 * 1000;

    private getFrontendUrl = () => process.env.FRONTEND_URL ?? "http://localhost:3000";

    // The staff record behind a signed in user, with what they're allowed to do.
    getStaff = async (userId: string) => {
        const staff = await prisma.staff.findUnique({ where: { userId } });
        if (!staff) throw new ForbiddenError("You are not allowed to access this resource.", ERROR_CODES.INSUFFICIENT_PERMISSIONS);

        const permissions = Array.isArray(staff.permissions) ? staff.permissions.filter((p): p is string => typeof p === "string") : [];
        return { ...staff, permissions };
    }

    // Emails a single-use link to create a staff account. Sending again to the same email revokes the earlier link,
    // so only the newest one works.
    inviteStaff = async (email: string, { invitorId = null, permissions = [] }: InviteOptions = {}) => {
        const existing = await prisma.user.findUnique({ where: { email }, select: { role: true } });

        if (existing) {
            const message = existing.role === UserRole.STAFF
                ? "This person is already a staff member."
                : "A customer account already uses this email. Staff need their own email address.";

            throw new ConflictError(message, ERROR_CODES.ACCOUNT_ALREADY_EXISTS);
        }

        const token = generateToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.INVITATION_LIFETIME);

        const invitation = await prisma.$transaction(async (tx) => {
            await tx.invitation.updateMany({
                where: { email, acceptedAt: null, revokedAt: null },
                data: { revokedAt: now },
            });

            return tx.invitation.create({
                data: { email, tokenHash: hashToken(token), invitorId, permissions, expiresAt },
            });
        });

        const link = `${this.getFrontendUrl()}/auth/invite/staff?token=${token}`;

        try {
            await this.messagingService.sendInvitation(email, "staff", link, expiresAt);
        } catch (error) {
            // Nobody received this link, so make sure it can't be used.
            await prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });

            console.error("Failed to send staff invitation:", error);
            throw new ServiceUnavailableError("We couldn't send the invitation email. Please try again.");
        }

        return { email, expiresAt };
    }

    // Finds an invitation that can still be accepted, or explains why it can't.
    private findUsableInvitation = async (token: string) => {
        const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });

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

    // Creates the staff account from an invitation. The invitation is claimed in the same transaction that creates
    // the account, so a link can't be used twice even by two requests at once.
    acceptInvitation = async ({ token, password, ...details }: AcceptStaffInvitationPayload) => {
        const invitation = await this.findUsableInvitation(token);

        const conflict = await prisma.user.findFirst({
            where: { OR: [{ email: invitation.email }, { phone: details.phone }] },
            select: { email: true },
        });

        if (conflict?.email === invitation.email) throw new ConflictError("An account with this email already exists.", ERROR_CODES.ACCOUNT_ALREADY_EXISTS);
        if (conflict) throw new ConflictError("An account with this phone number already exists.", ERROR_CODES.PHONE_ALREADY_IN_USE);

        const passwordHash = await hash(password);
        const now = new Date();

        const user = await prisma.$transaction(async (tx) => {
            const { count } = await tx.invitation.updateMany({
                where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
                data: { acceptedAt: now },
            });

            if (count === 0) throw new BadRequestError("This invitation link is invalid or has already been used.", ERROR_CODES.INVITATION_INVALID);

            // Opening the emailed link proves they own the address, so the account starts out verified.
            return tx.user.create({
                data: {
                    ...details,
                    email: invitation.email,
                    passwordHash,
                    role: UserRole.STAFF,
                    status: UserStatus.ACTIVE,
                    verifiedAt: now,
                    verifiedVia: VerificationMethod.EMAIL,
                    staff: { create: { permissions: invitation.permissions ?? [] } },
                },
            });
        });

        return createUserResponse(user);
    }
}
