import { createHash, createHmac, randomBytes } from "node:crypto";

// Single-use tokens sent in links, like invitations. They're random, so a fast hash is enough to store them safely:
// a leaked database only has the hashes, which can't be turned back into working links.
export const generateToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// A link token the server can make again but the database alone can't: an HMAC of `message` under `secret`. Stored as a
// hash plus whatever went into `message` (a random salt among it), so a leaked database still opens nothing. Used for
// the driver report link (REPORT_LINK_SECRET), which staff can show again.
export const keyedToken = (secret: string, message: string) =>
  createHmac("sha256", secret).update(message).digest("base64url");
