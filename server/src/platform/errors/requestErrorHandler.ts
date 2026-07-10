/**
 * Request Error Handler — centralized error context collection and handler wrapping.
 *
 * Replaces 127+ bare `catch (e) { next(e); }` blocks across route files
 * with structured error logging that includes novelId, chapterId, method, URL, etc.
 *
 * Usage:
 *   // Option A: Middleware-based (recommended for new routes)
 *   import { requestErrorHandler } from "@one2novel/platform/errors/requestErrorHandler";
 *   router.get("/:novelId/chapters/:chapterId", requestErrorHandler(async (req, res) => { ... }));
 *
 *   // Option B: Wrap individual handlers
 *   const wrapped = errorHandlerWrap(async (req, res, next) => { ... });
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

// ─── Request ID Generator ─────────────────────────────────

let requestIdCounter = 0;

function generateRequestId(): string {
  return `req_${Date.now()}_${++requestIdCounter}`;
}

// ─── Request Context Middleware ────────────────────────────

/**
 * Attach requestId, extract novelId/chapterId from params, and store
 * in res.locals for downstream error handlers to use.
 */
export function requestErrorHandler(req: Request, res: Response, next: NextFunction): void {
  (req as any).requestId = generateRequestId();
  res.locals.requestId = (req as any).requestId;
  res.locals.novelId = req.params.novelId ?? null;
  res.locals.chapterId = req.params.chapterId ?? null;
  next();
}

// ─── Handler Wrapper ───────────────────────────────────────

/**
 * Wrap an async Express handler to automatically catch errors,
 * attach request context, and pass to the error middleware.
 *
 * Replaces:
 *   try { ... } catch (e) { next(e); }
 * With:
 *   router.get("/", errorHandlerWrap(async (req, res) => { ... }));
 */
export function errorHandlerWrap(
  fn: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e) {
      // Attach request context to the error for structured logging
      if (e instanceof Error) {
        (e as any).requestId = (req as any).requestId;
        (e as any).novelId = req.params.novelId;
        (e as any).chapterId = req.params.chapterId;
        next(e);
      } else {
        next(e);
      }
    }
  };
}

/**
 * Variant that also passes next() to the wrapped function.
 * Use when the handler needs to call next() explicitly.
 */
export function errorHandlerWrapWithNext(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      if (e instanceof Error) {
        (e as any).requestId = (req as any).requestId;
        (e as any).novelId = req.params.novelId;
        (e as any).chapterId = req.params.chapterId;
      }
      next(e);
    }
  };
}
