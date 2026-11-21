import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../../src/platform/crypto/encryption";
import { compare, compareAgainstNothing, hash } from "../../src/platform/crypto/passwords";
import { generateToken, hashToken } from "../../src/platform/crypto/tokens";
import { createTotpSecret, verifyTotp } from "../../src/platform/crypto/totp";
import { totpCode } from "../support/factories";

describe("encryption", () => {
  it("round trips, with a fresh IV each time", () => {
    const a = encrypt("secret");
    const b = encrypt("secret");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("secret");
  });

  it("rejects a tampered value instead of decrypting it to garbage", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const stored = await hash("Hunter2-hunter2");
    expect(await compare("Hunter2-hunter2", stored)).toBe(true);
    expect(await compare("hunter2", stored)).toBe(false);
    expect(await compare("anything", "not-a-hash")).toBe(false);
    expect(await compareAgainstNothing("anything")).toBe(false);
  });
});

describe("tokens", () => {
  it("are random and hash the same way every time", () => {
    const token = generateToken();
    expect(token).not.toBe(generateToken());
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});

describe("totp", () => {
  it("accepts the current code and refuses to replay it", () => {
    const secret = createTotpSecret();
    const step = verifyTotp(secret, totpCode(secret), null);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret), step)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, 1), step)).toBe((step ?? 0) + 1);
  });

  it("rejects a wrong code", () => {
    const secret = createTotpSecret();
    const wrong = String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, "0");
    expect(verifyTotp(secret, wrong, null)).toBeNull();
  });
});
