import type { NextFunction, Request, Response } from "express";
import { getRedis } from "./redis";

const FIXED_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/**
 * Redis-backed fixed-window limiting is consistent across replicas. The Lua
 * script makes INCR and the first-request expiration atomic, unlike separate
 * commands that could race. Redis failures fail open so an analytics/control
 * plane outage does not take down shortening; abuse protection is temporarily
 * weaker until Redis recovers.
 */
export function createShortenRateLimiter(
  windowMs: number,
  maxRequests: number,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate-limit window must be a positive integer");
  }
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new Error("Rate-limit maximum must be a positive integer");
  }

  return (req, res, next): void => {
    void enforceLimit(req, res, next, windowMs, maxRequests);
  };
}

async function enforceLimit(
  req: Request,
  res: Response,
  next: NextFunction,
  windowMs: number,
  maxRequests: number,
): Promise<void> {
  const key = `rate-limit:shorten:${req.ip ?? "unknown"}`;

  try {
    const redis = await getRedis();
    const count = Number(
      await redis.eval(FIXED_WINDOW_SCRIPT, 1, key, windowMs),
    );

    if (count > maxRequests) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1_000));
      res.status(429).json({
        error: "Too many shortening requests; please try again later",
      });
      return;
    }
  } catch (error: unknown) {
    console.error("Redis rate-limit check failed; allowing request:", error);
  }

  next();
}
