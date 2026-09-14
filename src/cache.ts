import { getRedis } from "./redis";

export interface CachedUrl {
  longUrl: string;
  urlId: string;
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
  public async get(shortCode: string): Promise<CachedUrl | undefined> {
    try {
      const redis = await getRedis();
      const value = await redis.get(cacheKey(shortCode));
      if (!value) {
        return undefined;
      }

      const parsed: unknown = JSON.parse(value);
      if (!isCachedUrl(parsed)) {
        console.error(`Ignoring malformed Redis cache entry for ${shortCode}`);
        return undefined;
      }

      return parsed;
    } catch (error: unknown) {
      console.error("Redis cache read failed:", error);
      return undefined;
    }
  }

  public async set(shortCode: string, value: CachedUrl): Promise<void> {
    try {
      const redis = await getRedis();
      await redis.set(cacheKey(shortCode), JSON.stringify(value), "EX", cacheTtlSeconds);
    } catch (error: unknown) {
      console.error("Redis cache write failed:", error);
    }
  }

  public async invalidate(shortCode: string): Promise<void> {
    try {
      const redis = await getRedis();
      await redis.del(cacheKey(shortCode));
    } catch (error: unknown) {
      console.error("Redis cache invalidation failed:", error);
    }
  }

  public async update(shortCode: string, value: CachedUrl): Promise<void> {
    await this.set(shortCode, value);
  }
}

export const urlCache = new UrlCache();
