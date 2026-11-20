import { Secret, TOTP } from "otpauth";

// The code an authenticator app would show for this secret, `stepsAhead` 30-second steps from now. The server accepts
// one step either side, so a code one step ahead is valid and newer than one just used.
export const totpCode = (secret: string, stepsAhead = 0) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({
    timestamp: Date.now() + stepsAhead * 30_000,
  });
