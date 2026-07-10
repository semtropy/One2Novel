/**
 * Rate Limiter — singleton instances and Express middleware factory.
 */
import type { Request, Response, NextFunction } from "express";
import { SlidingWindowRateLimiter } from "./slidingWindow";
import { RATE_LIMIT_LLM_WINDOW_MS, RATE_LIMIT_LLM_MAX_REQUESTS } from "../config/constants";

/** LLM endpoint rate limiter — 20 requests per novelId per 60 seconds */
export const llmRateLimiter = new SlidingWindowRateLimiter({
  windowMs: RATE_LIMIT_LLM_WINDOW_MS,
  maxRequests: RATE_LIMIT_LLM_MAX_REQUESTS,
});

/** General endpoint rate limiter — 60 requests per novelId per 60 seconds */
export const generalRateLimiter = new SlidingWindowRateLimiter({
  windowMs: RATE_LIMIT_LLM_WINDOW_MS,
  maxRequests: 60,
});

/** Start periodic cleanup of expired rate limit windows */
llmRateLimiter.startAutoCleanup(60_000);
generalRateLimiter.startAutoCleanup(60_000);

/**
 * Extract a rate limit key from the request.
 * Falls back to IP if no novelId is available.
 */
export function rateLimitKey(req: Request): string {
  const novelId = req.params.novelId;
  if (typeof novelId === "string" && novelId) return `novel:${novelId}`;
  if (typeof novelId === "string") return novelId;
  return `ip:${req.ip || "unknown"}`;
}

/**
 * Express middleware factory for rate limiting.
 * Returns 429 with Chinese error message and Retry-After header when limit exceeded.
 */
export function rateLimitMiddleware(limiter: SlidingWindowRateLimiter, getKey: (req: Request) => string = rateLimitKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = getKey(req);
    const result = limiter.allow(key);

    // Set rate limit headers on every response
    res.set("X-RateLimit-Limit", String(result.maxRequests));
    res.set("X-RateLimit-Remaining", String(Math.max(0, result.maxRequests - result.currentCount)));

    if (!result.allowed) {
      res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "请求过于频繁，请稍后再试。",
          details: { retryAfterMs: result.retryAfterMs },
        },
      });
      return;
    }

    next();
  };
}

/** LLM rate limit middleware instance */
export const llmRateLimit = rateLimitMiddleware(llmRateLimiter);
