import { Hono } from "hono";
import { refreshHandler, sendVerificationHandler, sessionHandler, signInHandler, signOutHandler, signUpHandler } from "./auth.handlers.js";

const auth = new Hono()
    .post("/sign-up", ...signUpHandler)
    .post("/sign-in", ...signInHandler)
    .post("/refresh", ...refreshHandler)
    .post("/sign-out", ...signOutHandler)
    .get("/session", ...sessionHandler)
    .post("/verification/send", ...sendVerificationHandler)

export default auth;