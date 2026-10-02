import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts small secrets we need to read back later (like two-factor secrets), so a leaked database alone isn't enough
// to use them. AES-256-GCM also detects tampering: a modified value fails to decrypt instead of decrypting to garbage.
const getKey = () => {
    const secret = process.env.TOTP_ENCRYPTION_KEY;
    if (!secret) throw new Error("TOTP_ENCRYPTION_KEY is not defined. Please define it in the environment variables.");

    // Hashing turns any long random string into the 32 bytes AES-256 needs.
    return createHash("sha256").update(secret).digest();
};

// Stored as "v1.<iv>.<auth tag>.<ciphertext>", so the format can change later without breaking existing values.
export const encrypt = (plaintext: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
};

export const decrypt = (value: string) => {
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unrecognized encrypted value.");

    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
};
