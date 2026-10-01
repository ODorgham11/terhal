import { prisma } from "../../shared/utils/prisma.js";
import { hash } from "../../shared/utils/hash.js";
import { generateToken, hashToken } from "../../shared/utils/token.js";
import { BadRequestError, ConflictError, ERROR_CODES, ServiceUnavailableError } from "../../shared/utils/error.js";
import MessagingService from "../messaging/messaging.service.js";
import type { AcceptAdminInvitationPayload } from "./admin.validators.js";

type InviteOptions = {
    // The admin sending the invitation, or null when it comes from the seed.
    invitorId?: string | null;
};

export default class AdminService {
    private readonly messagingService = new MessagingService();

    // Shorter than staff invitations, since an admin account has more power.
    private readonly INVITATION_LIFETIME = 48 * 60 * 60 * 1000;

    private getFrontendUrl = () => process.env.FRONTEND_URL ?? "http://localhost:3000";

    // Emails a single-use link to create an admin account. Sending again to the same email revokes the earlier link,
    // so only the newest one works.
    inviteAdmin = async (email: string, { invitorId = null }: InviteOptions = {}) => {
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

    // Creates the admin account from an invitation. The invitation is claimed in the same transaction that creates
    // the account, so a link can't be used twice even by two requests at once.
    acceptInvitation = async ({ token, password, ...details }: AcceptAdminInvitationPayload) => {
        const invitation = await this.findUsableInvitation(token);

        const existing = await prisma.admin.findUnique({ where: { email: invitation.email }, select: { id: true } });
        if (existing) throw new ConflictError("An admin account with this email already exists.", ERROR_CODES.ACCOUNT_ALREADY_EXISTS);

        const passwordHash = await hash(password);
        const now = new Date();

        const admin = await prisma.$transaction(async (tx) => {
            const { count } = await tx.adminInvitation.updateMany({
                where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
                data: { acceptedAt: now },
            });

            if (count === 0) throw new BadRequestError("This invitation link is invalid or has already been used.", ERROR_CODES.INVITATION_INVALID);

            return tx.admin.create({
                data: { ...details, email: invitation.email, passwordHash },
            });
        });

        return { id: admin.id, firstName: admin.firstName, lastName: admin.lastName, email: admin.email };
    }
}
