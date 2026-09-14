"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = process.env.REDIS_URL;
let redisClient;
let connectionPromise;
/**
 * Both Redis concerns share one connection. Redis is now the shared state
 * layer across app replicas; at larger scale, a managed rate-limit service or
 * CDN-edge caching could move this work closer to users.
 */
function getRedis() {
    if (!redisUrl) {
        return Promise.reject(new Error("REDIS_URL is required for Redis-backed cache and rate limiting"));
    }
    if (redisClient?.status === "ready") {
        return Promise.resolve(redisClient);
    }
    if (!connectionPromise) {
        const client = new ioredis_1.default(redisUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
        });
        client.on("error", (error) => {
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
            .catch((error) => {
            connectionPromise = undefined;
            client.disconnect();
            throw error;
        });
    }
    return connectionPromise;
}
