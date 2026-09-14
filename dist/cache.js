"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlCache = void 0;
const redis_1 = require("./redis");
const observability_1 = require("./observability");
const CACHE_KEY_PREFIX = "url:";
const cacheTtlSeconds = Number(process.env.REDIS_CACHE_TTL_SECONDS ?? 3_600);
if (!Number.isInteger(cacheTtlSeconds) || cacheTtlSeconds < 1) {
    throw new Error("REDIS_CACHE_TTL_SECONDS must be a positive integer");
}
function cacheKey(shortCode) {
    return `${CACHE_KEY_PREFIX}${shortCode}`;
}
function isCachedUrl(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return typeof candidate.longUrl === "string" && typeof candidate.urlId === "string";
}
/**
 * Redis-backed cache shared by all app replicas.
 *
 * On Redis failure, reads return a miss so the caller falls through to
 * Postgres, while writes/invalidation are logged and skipped. This keeps
 * redirects available during a cache outage at the cost of more DB traffic.
 */
class UrlCache {
    async get(shortCode) {
        try {
            const redis = await (0, redis_1.getRedis)();
            const value = await redis.get(cacheKey(shortCode));
            if (!value) {
                (0, observability_1.recordCacheMiss)();
                return undefined;
            }
            const parsed = JSON.parse(value);
            if (!isCachedUrl(parsed)) {
                (0, observability_1.recordCacheMiss)();
                observability_1.logger.warn({ shortCode }, "Ignoring malformed Redis cache entry");
                return undefined;
            }
            (0, observability_1.recordCacheHit)();
            return parsed;
        }
        catch (error) {
            (0, observability_1.recordCacheMiss)();
            observability_1.logger.error({ err: error }, "Redis cache read failed");
            return undefined;
        }
    }
    async set(shortCode, value) {
        try {
            const redis = await (0, redis_1.getRedis)();
            await redis.set(cacheKey(shortCode), JSON.stringify(value), "EX", cacheTtlSeconds);
        }
        catch (error) {
            observability_1.logger.error({ err: error }, "Redis cache write failed");
        }
    }
    async invalidate(shortCode) {
        try {
            const redis = await (0, redis_1.getRedis)();
            await redis.del(cacheKey(shortCode));
        }
        catch (error) {
            observability_1.logger.error({ err: error }, "Redis cache invalidation failed");
        }
    }
    async update(shortCode, value) {
        await this.set(shortCode, value);
    }
}
exports.urlCache = new UrlCache();
