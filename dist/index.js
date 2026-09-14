"use strict";
/*
 * Usage:
 *   npm run dev
 *   curl -X POST http://localhost:3000/shorten ^
 *     -H "Content-Type: application/json" ^
 *     -d "{\"url\":\"https://example.com\"}"
 *   curl -i http://localhost:3000/<shortCode>
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const base62_1 = require("./base62");
const cache_1 = require("./cache");
const clicks_1 = require("./clicks");
const db_1 = require("./db");
const rateLimit_1 = require("./rateLimit");
const redis_1 = require("./redis");
const observability_1 = require("./observability");
exports.app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 3000);
const configuredBaseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;
exports.app.use(express_1.default.json());
exports.app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const route = typeof req.route?.path === "string" ? req.route.path : req.path;
        (0, observability_1.recordRequest)(route, res.statusCode, durationSeconds);
        observability_1.logger.info({
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            responseTimeMs: Number((durationSeconds * 1_000).toFixed(3)),
        }, "request completed");
    });
    next();
});
const shortenRateLimiter = (0, rateLimit_1.createShortenRateLimiter)(Number(process.env.SHORTEN_RATE_LIMIT_WINDOW_MS ?? 60_000), Number(process.env.SHORTEN_RATE_LIMIT_MAX ?? 10));
exports.app.get("/health", async (_req, res) => {
    const dependencyStatus = {
        postgres: "ok",
        redis: "ok",
    };
    try {
        await db_1.pool.query("SELECT 1");
    }
    catch (error) {
        dependencyStatus.postgres = "error";
        observability_1.logger.error({ err: error }, "Postgres health check failed");
    }
    try {
        const redis = await (0, redis_1.getRedis)();
        await redis.ping();
    }
    catch (error) {
        dependencyStatus.redis = "error";
        observability_1.logger.error({ err: error }, "Redis health check failed");
    }
    const healthy = dependencyStatus.postgres === "ok" && dependencyStatus.redis === "ok";
    res.status(healthy ? 200 : 503).json({
        status: healthy ? "ok" : "error",
        ...dependencyStatus,
    });
});
exports.app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", observability_1.metricsRegistry.contentType);
    res.send(await observability_1.metricsRegistry.metrics());
});
exports.app.post("/shorten", shortenRateLimiter, async (req, res) => {
    const { url } = req.body;
    if (typeof url !== "string" || url.trim().length === 0) {
        res.status(400).json({ error: "Request body must include a non-empty url string" });
        return;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    }
    catch {
        res.status(400).json({ error: "The url must be a well-formed URL" });
        return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        res.status(400).json({ error: "The url must use http or https" });
        return;
    }
    let client;
    try {
        client = await db_1.pool.connect();
        await client.query("BEGIN");
        // The sequence-generated id is unique. Encoding it creates a
        // deterministic short code without randomness or retry-on-collision logic.
        const inserted = await client.query("INSERT INTO urls (long_url) VALUES ($1) RETURNING id", [parsedUrl.toString()]);
        const id = Number(inserted.rows[0]?.id);
        if (!Number.isSafeInteger(id) || id < 0) {
            throw new Error("Database returned an invalid URL id");
        }
        const shortCode = (0, base62_1.encodeBase62)(id);
        await client.query("UPDATE urls SET short_code = $1 WHERE id = $2", [shortCode, inserted.rows[0].id]);
        await client.query("COMMIT");
        await cache_1.urlCache.update(shortCode, {
            longUrl: parsedUrl.toString(),
            urlId: inserted.rows[0].id,
        });
        res.status(201).json({
            shortCode,
            shortUrl: `${configuredBaseUrl.replace(/\/+$/, "")}/${shortCode}`,
        });
    }
    catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            }
            catch (rollbackError) {
                observability_1.logger.error({ err: rollbackError }, "Failed to roll back URL creation");
            }
        }
        observability_1.logger.error({ err: error }, "Failed to shorten URL");
        res.status(500).json({ error: "Unable to shorten URL" });
    }
    finally {
        client?.release();
    }
});
exports.app.get("/:code", async (req, res) => {
    const { code } = req.params;
    try {
        let cached = await cache_1.urlCache.get(code);
        if (!cached) {
            const result = await db_1.pool.query("SELECT id, long_url FROM urls WHERE short_code = $1", [code]);
            const row = result.rows[0];
            if (!row) {
                res.status(404).json({ error: "Short URL not found" });
                return;
            }
            cached = { longUrl: row.long_url, urlId: row.id };
            await cache_1.urlCache.set(code, cached);
        }
        res.redirect(302, cached.longUrl);
        void (0, clicks_1.logClick)(cached.urlId).catch((error) => {
            observability_1.logger.error({ err: error }, "Failed to log click");
        });
    }
    catch (error) {
        observability_1.logger.error({ err: error }, "Failed to resolve short URL");
        res.status(500).json({ error: "Unable to resolve short URL" });
    }
});
if (require.main === module) {
    exports.app.listen(port, () => {
        observability_1.logger.info({ port }, "URL shortener listening");
    });
}
