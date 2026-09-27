// The Hono app itself, with no side effects (no listening, no port binding).
// This is imported by two different entry points:
// 1) src/index.ts serves up a local dev server, via @hono/node-server
// 2) api/index.ts exports a Vercel serverless entry point, via @hono/vercel
// Keeping the app definition separate from "how it's run" is what lets the
// same route code work in both places without duplication.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'

import AppError from './shared/utils/error.js'

import health from './domains/health/health.routes.js'
import auth from './domains/auth/auth.routes.js'

const app = new Hono()
  .use('*', logger())
  .use('*', secureHeaders())
  .use('*', cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }))
  .onError((err, c) => {
    // Handle the AppErrors we throw throughout the application's logic.
    if (err instanceof AppError) {
      return c.json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      }, err.statusCode);
    }

    // Handle the validation errors that we have on each validatable route.
    if (err instanceof HTTPException) {
      const cause = err.cause;

      // Unpack the error and parse it into a formattable form on the frontend.
      if (cause instanceof ZodError) {
        return c.json({
          success: false,
          error: {
            message: "Validation failed",
            fields: cause.issues.map(i => ({
              field: i.path.join("."),
              message: i.message,
            })),
          },
        }, 400);
      };

      return c.json({
        success: false,
        error: {
          message: err.message,
        },
      }, err.status);
    }

    // If neither this nor that, return an internal server error.
    console.error("Unhandled error:", err);

    return c.json({
      success: false,
      error: {
        message: "Internal Server Error",
      },
    }, 500);
  })
  .route('/health', health)
  .route('/auth', auth)

export type AppType = typeof app;
export default app;
