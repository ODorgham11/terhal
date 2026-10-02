import { logger } from "hono/logger";

// Query parameters whose values are secrets. Hono's logger prints the full path including the query string,
// and request logs are read far more widely than the database, so these never reach them.
const sensitiveParams = ["token", "code", "password", "secret"];

const pattern = new RegExp(`([?&](?:${sensitiveParams.join("|")})=)[^&\\s]*`, "gi");

export const redact = (text: string) => text.replace(pattern, "$1[REDACTED]");

export const requestLogger = () => logger((message, ...rest) => console.log(redact(message), ...rest));
