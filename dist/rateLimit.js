"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createShortenRateLimiter = createShortenRateLimiter;
const redis_1 = require("./redis");
const observability_1 = require("./observability");
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
function createShortenRateLimiter(windowMs, maxRequests) {
    if (!Number.isInteger(windowMs) || windowMs < 1) {
        throw new Error("Rate-limit window must be a positive integer");
    }
    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
        throw new Error("Rate-limit maximum must be a positive integer");
    }
    return (req, res, next) => {
        void enforceLimit(req, res, next, windowMs, maxRequests);
    };
}
async function enforceLimit(req, res, next, windowMs, maxRequests) {
    const key = `rate-limit:shorten:${req.ip ?? "unknown"}`;
    try {
        const redis = await (0, redis_1.getRedis)();
        const count = Number(await redis.eval(FIXED_WINDOW_SCRIPT, 1, key, windowMs));
        if (count > maxRequests) {
            (0, observability_1.recordRateLimitRejection)();
            res.setHeader("Retry-After", Math.ceil(windowMs / 1_000));
            res.status(429).json({
                error: "Too many shortening requests; please try again later",
            });
            return;
        }
    }
    catch (error) {
        observability_1.logger.error({ err: error }, "Redis rate-limit check failed; allowing request");
    }
    next();
}
