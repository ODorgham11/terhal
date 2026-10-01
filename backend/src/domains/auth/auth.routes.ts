import { Hono } from "hono";
import { confirmVerificationHandler, refreshHandler, sendVerificationHandler, sessionHandler, verificationStatusHandler, signInHandler, signOutHandler, signUpHandler } from "./auth.handlers.js";

const auth = new Hono()
    .post("/sign-up", ...signUpHandler)
    .post("/sign-in", ...signInHandler)
    .post("/refresh", ...refreshHandler)
    .post("/sign-out", ...signOutHandler)
    .get("/session", ...sessionHandler)
    .get("/verification", ...verificationStatusHandler)
    .post("/verification/send", ...sendVerificationHandler)
    .post("/verification/confirm", ...confirmVerificationHandler)

export default auth;