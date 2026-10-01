import { createUserResponse, SignInSchemaPayload, SignUpSchemaPayload } from "./auth.validators.js";
import { prisma } from "../../shared/utils/prisma.js";
import { ERROR_CODES, BadRequestError, ConflictError, ForbiddenError, ServiceUnavailableError, TooManyRequestsError, UnauthorizedError } from "../../shared/utils/error.js";
import MessagingService from "../messaging/messaging.service.js";
import { hash, compare } from "../../shared/utils/hash.js";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import TokenService from "../token/token.service.js";
import { UserStatus, VerificationMethod } from "../../../generated/prisma/enums.js";
import type { User } from "../../../generated/prisma/client.js";

export default class AuthService {
    private readonly messagingService = new MessagingService();

    private readonly MAXIMUM_SESSION_LIMIT = 5;
    private readonly MAXIMUM_VERIFICATION_ATTEMPTS = 5;
    private readonly VERIFICATION_CODE_LIFETIME = 10 * 60 * 1000;
    private readonly VERIFICATION_RESEND_COOLDOWN = 60 * 1000;
    private readonly INACTIVE_STATUS: UserStatus[] = [UserStatus.SUSPENDED, UserStatus.DELETED];

    // Claims carried by the user's access token. A user only counts as verified when their account is active and they have completed verification.
    private getTokenClaims = (user: User) => ({
        role: user.role,
        verified: user.status === UserStatus.ACTIVE && user.verifiedAt !== null,
    });

    // Keying the hash with the app secret prevents a plain hash from being instantly reserved, and including the user id ties the code to this user only.
    private hashVerificationCode = (userId: string, code: string) => {
        const secret = process.env.APP_SECRET;
        if (!secret) throw new Error("APP_SECRET is not defined. Please define it in the environment variables.");

        return createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");
    }

    // Shows where the code was sent without exposing the full address, e.g. a•••@example.com or +20•••••5678.
    private maskDestination = (method: VerificationMethod, destination: string) => {
        if (method === VerificationMethod.EMAIL) {
            const [name, domain] = destination.split("@");
            return `${name[0]}•••@${domain}`;
        }

        return `${destination.slice(0, 3)}${"•".repeat(Math.max(0, destination.length - 7))}${destination.slice(-4)}`;
    }

    createUser = async (payload: SignUpSchemaPayload) => {
        // Start by making sure that user doesn't exist in our database first.
        const exists = await prisma.user.findFirst({
            where: { OR: [{ email: payload.email }, { phone: payload.phone }] },
            select: { email: true, phone: true },
        });

        if (exists?.email === payload.email) throw new ConflictError("An account with this email already exists.", ERROR_CODES.EMAIL_ALREADY_IN_USE);
        if (exists?.phone === payload.phone) throw new ConflictError("An account with this phone number already exists.", ERROR_CODES.PHONE_ALREADY_IN_USE);

        // If the user does not exist yet, hash the password, and extract data.
        const passwordHash = await hash(payload.password);
        const { password, ...data } = payload;

        // Create the user in the proper user response shape.
        const user = await prisma.user.create({ 
            data: {
                ...data,
                passwordHash
            }
        });

        return createUserResponse(user);
    }

    signIn = async (payload: SignInSchemaPayload, ipAddress: string | null, userAgent: string | null) => {
        // Find the user account, make sure the password is correct, and make sure the status is ok to sign in.
        const user = await prisma.user.findUnique({ where: payload.identifier });

        // Use the same error for both cases so the response doesn't reveal which accounts exist.
        if (!user) throw new UnauthorizedError("Could not find user account with the specified credentials.", ERROR_CODES.INVALID_CREDENTIALS);

        const isValid = await compare(payload.password, user.passwordHash);
        if (!isValid) throw new UnauthorizedError("Could not find user account with the specified credentials.", ERROR_CODES.INVALID_CREDENTIALS);

        if (this.INACTIVE_STATUS.includes(user.status)) throw new ForbiddenError("User account is not active. You are not allowed to sign in.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);

        // If the user passes the validation, generate the refresh and access tokens.
        const { accessToken, refreshToken, refreshTokenHash, expiresAt } = await TokenService.generateTokenPair("user", user.id, this.getTokenClaims(user));

        // Invalidate other sessions if they are above the maximum limit and store this session with the information extracted from the request.
        const activeSessions = await prisma.userSession.findMany({
            where: {
                userId: user.id,
                revokedAt: null,
                expiresAt: { gt: new Date() }
            },
            orderBy: { createdAt: "asc" }, // Sort by the oldest to the newest.
            select: { id: true }
        });

        // Revoke the oldest sessions to make way for the new session being created.
        const sessionsToRevoke = activeSessions.slice(0, Math.max(0, activeSessions.length - this.MAXIMUM_SESSION_LIMIT + 1));

        // Wrap in a transaction to make sure this happens atomically.
        await prisma.$transaction(async (tx) => {
            if (sessionsToRevoke.length > 0) {
                await tx.userSession.updateMany({
                    where: { id: { in: sessionsToRevoke.map((session) => session.id) } },
                    data: { revokedAt: new Date() }
                });
            };

            await tx.userSession.create({
                data: {
                    userId: user.id,
                    refreshToken: refreshTokenHash,
                    expiresAt,
                    ipAddress,
                    userAgent
                }
            });
        });

        return {
            user: createUserResponse(user),
            accessToken,
            refreshToken,
            expiresAt
        };
    }

    refresh = async (refreshToken: string | undefined, ipAddress: string | null, userAgent: string | null) => {
        if (!refreshToken) throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);

        // Sessions only store the hash of the refresh token, so look it up the same way.
        const currentHash = TokenService.hashRefreshToken(refreshToken);
        const session = await prisma.userSession.findUnique({ where: { refreshToken: currentHash }, include: { user: true } });

        if (!session) throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);

        // Refreshing slides the expiry forward, so also enforce a 30-day absolute lifetime counted from when the user signed in.
        const absoluteExpiresAt = new Date(session.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        const now = new Date();

        if (session.revokedAt || session.expiresAt <= now || absoluteExpiresAt <= now) {
            throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);
        }

        // Check the user again, since their status may have changed since they signed in.
        const { user } = session;

        if (this.INACTIVE_STATUS.includes(user.status)) {
            await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
            throw new ForbiddenError("User account is not active. You are not allowed to sign in.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        }

        // Issue new tokens with the user's current claims, so role and verification changes apply from the next refresh.
        const { accessToken, refreshToken: newRefreshToken, refreshTokenHash, expiresAt: slidingExpiresAt } = await TokenService.generateTokenPair("user", user.id, this.getTokenClaims(user));

        // Never extend the session past its absolute lifetime.
        const expiresAt = slidingExpiresAt < absoluteExpiresAt ? slidingExpiresAt : absoluteExpiresAt;

        // Rotate the refresh token in place, so a session still represents a single device.
        // Matching on the old hash makes sure two requests can't both use the same refresh token.
        const { count } = await prisma.userSession.updateMany({
            where: { id: session.id, refreshToken: currentHash, revokedAt: null },
            data: { refreshToken: refreshTokenHash, expiresAt, ipAddress, userAgent }
        });

        if (count === 0) throw new UnauthorizedError("Your session is invalid or has expired. Please sign in again.", ERROR_CODES.INVALID_REFRESH_TOKEN);

        return {
            user: createUserResponse(user),
            accessToken,
            refreshToken: newRefreshToken,
            expiresAt
        };
    }

    // Revokes the session behind this refresh token. Signing out always succeeds, even when the session is already gone.
    signOut = async (refreshToken: string | undefined) => {
        if (!refreshToken) return;

        await prisma.userSession.updateMany({
            where: { refreshToken: TokenService.hashRefreshToken(refreshToken), revokedAt: null },
            data: { revokedAt: new Date() }
        });
    }

    // Loads the signed in user's profile, and checks their status since the access token can't reflect changes made after it was issued.
    getSession = async (userId: string) => {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        if (this.INACTIVE_STATUS.includes(user.status)) throw new ForbiddenError("User account is not active. You are not allowed to sign in.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);

        return createUserResponse(user);
    }

    // Generates a new verification code and sends it through the method the user picked at sign up.
    sendVerificationCode = async (userId: string) => {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        if (this.INACTIVE_STATUS.includes(user.status)) throw new ForbiddenError("User account is not active. You are not allowed to sign in.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        if (this.getTokenClaims(user).verified) throw new ConflictError("Your account is already verified.", ERROR_CODES.ALREADY_VERIFIED);

        const method = user.verificationMethod ?? VerificationMethod.EMAIL;
        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

        const now = Date.now();
        const expiresAt = new Date(now + this.VERIFICATION_CODE_LIFETIME);

        // A code was sent less than a minute ago if it expires later than this, since every code gets the same lifetime.
        const cooldownThreshold = new Date(now - this.VERIFICATION_RESEND_COOLDOWN + this.VERIFICATION_CODE_LIFETIME);

        // Only store the new code if the cooldown has passed, checked in the same statement so two requests at once can't both send a code.
        const { count } = await prisma.user.updateMany({
            where: {
                id: user.id,
                OR: [{ verificationExpiresAt: null }, { verificationExpiresAt: { lte: cooldownThreshold } }]
            },
            data: {
                verificationHash: this.hashVerificationCode(user.id, code),
                verificationExpiresAt: expiresAt,
                verificationAttempts: 0,
                verificationMethod: method
            }
        });

        if (count === 0) {
            const retryAfter = Math.ceil((user.verificationExpiresAt!.getTime() - cooldownThreshold.getTime()) / 1000);
            throw new TooManyRequestsError(`Please wait ${retryAfter} seconds before requesting a new code.`, ERROR_CODES.VERIFICATION_COOLDOWN);
        }

        const destination = method === VerificationMethod.EMAIL ? user.email : user.phone;

        try {
            await this.messagingService.sendVerificationCode(method, destination, code);
        } catch (error) {
            // The code never reached the user, so remove it to let them retry right away instead of waiting out the cooldown.
            await prisma.user.update({
                where: { id: user.id },
                data: { verificationHash: null, verificationExpiresAt: null, verificationAttempts: 0 }
            });

            console.error("Failed to send verification code:", error);
            throw new ServiceUnavailableError("We couldn't send your verification code. Please try again.");
        }

        return {
            method,
            destination: this.maskDestination(method, destination),
            expiresAt,
            resendAvailableAt: new Date(now + this.VERIFICATION_RESEND_COOLDOWN)
        };
    }

    // Describes the user's current code without sending a new one, so the client can pick up where it left off after a refresh.
    getVerificationStatus = async (userId: string) => {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        if (this.INACTIVE_STATUS.includes(user.status)) throw new ForbiddenError("User account is not active. You are not allowed to sign in.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        if (this.getTokenClaims(user).verified) throw new ConflictError("Your account is already verified.", ERROR_CODES.ALREADY_VERIFIED);

        const method = user.verificationMethod ?? VerificationMethod.EMAIL;
        const destination = method === VerificationMethod.EMAIL ? user.email : user.phone;
        const expiresAt = user.verificationExpiresAt;

        // A code can still be entered while it's stored, unexpired, and has attempts left.
        const pending = !!user.verificationHash && !!expiresAt && expiresAt.getTime() > Date.now()
            && user.verificationAttempts < this.MAXIMUM_VERIFICATION_ATTEMPTS;

        // Every code gets the same lifetime, so when it was sent (and when the cooldown ends) follows from when it expires.
        const resendAvailableAt = expiresAt
            ? new Date(expiresAt.getTime() - this.VERIFICATION_CODE_LIFETIME + this.VERIFICATION_RESEND_COOLDOWN)
            : null;

        return {
            method,
            destination: this.maskDestination(method, destination),
            pending,
            expiresAt: pending ? expiresAt : null,
            resendAvailableAt
        };
    }

    // Checks the code the user entered and verifies their account when it matches.
    confirmVerificationCode = async (userId: string, code: string) => {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        if (this.INACTIVE_STATUS.includes(user.status)) throw new ForbiddenError("User account is not active. You are not allowed to sign in.", ERROR_CODES.ACCOUNT_NOT_ACTIVE);
        if (this.getTokenClaims(user).verified) throw new ConflictError("Your account is already verified.", ERROR_CODES.ALREADY_VERIFIED);

        const now = new Date();
        const storedHash = user.verificationHash;

        if (!storedHash || !user.verificationExpiresAt || user.verificationExpiresAt <= now) {
            throw new BadRequestError("Your verification code has expired. Please request a new code.", ERROR_CODES.VERIFICATION_CODE_EXPIRED);
        }

        if (user.verificationAttempts >= this.MAXIMUM_VERIFICATION_ATTEMPTS) {
            throw new TooManyRequestsError("Too many incorrect attempts. Please request a new code.", ERROR_CODES.TOO_MANY_ATTEMPTS);
        }

        // Count the attempt before comparing, in a single statement, so sending many guesses at once can't get past the limit.
        // Matching on the stored hash also means an attempt on a code that was just replaced doesn't count against the new one.
        const { count: counted } = await prisma.user.updateMany({
            where: {
                id: user.id,
                verificationHash: storedHash,
                verificationExpiresAt: { gt: now },
                verificationAttempts: { lt: this.MAXIMUM_VERIFICATION_ATTEMPTS }
            },
            data: { verificationAttempts: { increment: 1 } }
        });

        if (counted === 0) throw new TooManyRequestsError("Too many incorrect attempts. Please request a new code.", ERROR_CODES.TOO_MANY_ATTEMPTS);

        // Compare in constant time, so response timing doesn't reveal how close a guess was.
        const isValid = timingSafeEqual(Buffer.from(this.hashVerificationCode(user.id, code), "hex"), Buffer.from(storedHash, "hex"));

        if (!isValid) {
            const remaining = this.MAXIMUM_VERIFICATION_ATTEMPTS - (user.verificationAttempts + 1);

            if (remaining <= 0) throw new TooManyRequestsError("Too many incorrect attempts. Please request a new code.", ERROR_CODES.TOO_MANY_ATTEMPTS);
            throw new BadRequestError(`The code you entered is incorrect. You have ${remaining} ${remaining === 1 ? "attempt" : "attempts"} remaining.`, ERROR_CODES.VERIFICATION_CODE_INVALID);
        }

        // Only matches while this code is still the stored one and the status hasn't changed, so a code can only be used once
        // and a user suspended in the meantime isn't activated.
        const { count: verified } = await prisma.user.updateMany({
            where: { id: user.id, verificationHash: storedHash, status: user.status },
            data: {
                status: UserStatus.ACTIVE,
                verifiedAt: now,
                verifiedVia: user.verificationMethod ?? VerificationMethod.EMAIL,
                verificationHash: null,
                verificationExpiresAt: null,
                verificationAttempts: 0
            }
        });

        if (verified === 0) throw new BadRequestError("Your verification code has expired. Please request a new code.", ERROR_CODES.VERIFICATION_CODE_EXPIRED);
    }
}
