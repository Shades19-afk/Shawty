import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

let redisClient: Redis | undefined;
let connectionPromise: Promise<Redis> | undefined;

/**
 * Both Redis concerns share one connection. Redis is now the shared state
 * layer across app replicas; at larger scale, a managed rate-limit service or
 * CDN-edge caching could move this work closer to users.
 */
export function getRedis(): Promise<Redis> {
  if (!redisUrl) {
    return Promise.reject(
      new Error("REDIS_URL is required for Redis-backed cache and rate limiting"),
    );
  }

  if (redisClient?.status === "ready") {
    return Promise.resolve(redisClient);
  }

  if (!connectionPromise) {
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    client.on("error", (error: Error) => {
      console.error("Redis connection error:", error);
    });
    client.on("end", () => {
      redisClient = undefined;
      connectionPromise = undefined;
    });

    connectionPromise = client.connect()
      .then(() => {
        redisClient = client;
        return client;
      })
      .catch((error: unknown) => {
        connectionPromise = undefined;
        client.disconnect();
        throw error;
      });
  }

  return connectionPromise;
}
