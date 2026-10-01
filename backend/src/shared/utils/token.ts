import { createHash, randomBytes } from "node:crypto";

// Single-use tokens sent in links, like invitations. They're random, so a fast hash is enough to store them safely:
// a leaked database only has the hashes, which can't be turned back into working links.
export const generateToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
