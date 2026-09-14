import { getRedis } from "./redis";
import { logger, recordCacheHit, recordCacheMiss } from "./observability";

export interface CachedUrl {
  longUrl: string;
  urlId: string;
  expiresAt: string;
}

const CACHE_KEY_PREFIX = "url:";
const cacheTtlSeconds = Number(process.env.REDIS_CACHE_TTL_SECONDS ?? 3_600);

if (!Number.isInteger(cacheTtlSeconds) || cacheTtlSeconds < 1) {
  throw new Error("REDIS_CACHE_TTL_SECONDS must be a positive integer");
}

function cacheKey(shortCode: string): string {
  return `${CACHE_KEY_PREFIX}${shortCode}`;
}

function isCachedUrl(value: unknown): value is CachedUrl {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.longUrl === "string" &&
    typeof candidate.urlId === "string" &&
    typeof candidate.expiresAt === "string"
  );
}

/**
 * Redis-backed cache shared by all app replicas.
 *
 * On Redis failure, reads return a miss so the caller falls through to
 * Postgres, while writes/invalidation are logged and skipped. This keeps
 * redirects available during a cache outage at the cost of more DB traffic.
 *
 * Expiration is stored and checked on every cache hit rather than relying only
 * on Redis TTL, so an entry cannot serve a redirect after its link expires.
 */
class UrlCache {
  public async get(shortCode: string): Promise<CachedUrl | undefined> {
    try {
      const redis = await getRedis();
      const value = await redis.get(cacheKey(shortCode));
      if (!value) {
        recordCacheMiss();
        return undefined;
      }

      const parsed: unknown = JSON.parse(value);
      if (!isCachedUrl(parsed)) {
        recordCacheMiss();
        logger.warn({ shortCode }, "Ignoring malformed Redis cache entry");
        return undefined;
      }

      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        recordCacheMiss();
        return undefined;
      }

      recordCacheHit();
      return parsed;
    } catch (error: unknown) {
      recordCacheMiss();
      logger.error({ err: error }, "Redis cache read failed");
      return undefined;
    }
  }

  public async set(shortCode: string, value: CachedUrl): Promise<void> {
    try {
      const redis = await getRedis();
      await redis.set(cacheKey(shortCode), JSON.stringify(value), "EX", cacheTtlSeconds);
    } catch (error: unknown) {
      logger.error({ err: error }, "Redis cache write failed");
    }
  }

  public async invalidate(shortCode: string): Promise<void> {
    try {
      const redis = await getRedis();
      await redis.del(cacheKey(shortCode));
    } catch (error: unknown) {
      logger.error({ err: error }, "Redis cache invalidation failed");
    }
  }

  public async update(shortCode: string, value: CachedUrl): Promise<void> {
    await this.set(shortCode, value);
  }
}

export const urlCache = new UrlCache();
