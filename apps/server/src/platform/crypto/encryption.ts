import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env";

// Encrypts small secrets we need to read back later (like two-factor secrets), so a leaked database alone isn't enough
// to use them. AES-256-GCM also detects tampering: a modified value fails to decrypt instead of decrypting to garbage.
// Hashing turns any long random string into the 32 bytes AES-256 needs.
const getKey = () => createHash("sha256").update(env.TOTP_ENCRYPTION_KEY).digest();

// Stored as "v1.<iv>.<auth tag>.<ciphertext>", so the format can change later without breaking existing values.
export const encrypt = (plaintext: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return ["v1", iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
};

// A link token the server can make again but the database alone can't: an HMAC of `message` under a key derived from
// the encryption key for this `purpose` only. Stored as a hash plus whatever went into `message` (a random salt among
// it), so a leaked database still opens nothing. Used for the driver report link, which staff can show again.
export const keyedToken = (purpose: string, message: string) => {
  const key = createHmac("sha256", env.TOTP_ENCRYPTION_KEY).update(`terhal:${purpose}`).digest();
  return createHmac("sha256", key).update(message).digest("base64url");
};

export const decrypt = (value: string) => {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Unrecognized encrypted value.");

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
