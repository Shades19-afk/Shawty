import "./env";

/*
 * Usage:
 *   npm run dev
 *   curl -X POST http://localhost:3000/shorten ^
 *     -H "Content-Type: application/json" ^
 *     -d "{\"url\":\"https://example.com\"}"
 *   curl -i http://localhost:3000/<shortCode>
 */

import express, { type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { encodeBase62 } from "./base62";
import { urlCache } from "./cache";
import { logClick } from "./clicks";
import { pool } from "./db";
import { createShortenRateLimiter } from "./rateLimit";
import { getRedis } from "./redis";
import {
  logger,
  metricsRegistry,
  recordRequest,
} from "./observability";

interface ShortenRequestBody {
  url?: unknown;
}

interface CodeRouteParams {
  code: string;
}

interface UrlRow {
  id: string;
}

interface LongUrlRow {
  id: string;
  long_url: string;
}

export const app = express();
const port = Number(process.env.PORT ?? 3000);
const configuredBaseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

app.use(express.json());

app.use((req, res, next): void => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = typeof req.route?.path === "string" ? req.route.path : req.path;
    recordRequest(route, res.statusCode, durationSeconds);
    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTimeMs: Number((durationSeconds * 1_000).toFixed(3)),
      },
      "request completed",
    );
  });
  next();
});

const shortenRateLimiter = createShortenRateLimiter(
  Number(process.env.SHORTEN_RATE_LIMIT_WINDOW_MS ?? 60_000),
  Number(process.env.SHORTEN_RATE_LIMIT_MAX ?? 10),
);

app.get("/health", async (_req: Request, res: Response): Promise<void> => {
  const dependencyStatus = {
    postgres: "ok",
    redis: "ok",
  };

  try {
    await pool.query("SELECT 1");
  } catch (error: unknown) {
    dependencyStatus.postgres = "error";
    logger.error({ err: error }, "Postgres health check failed");
  }

  try {
    const redis = await getRedis();
    await redis.ping();
  } catch (error: unknown) {
    dependencyStatus.redis = "error";
    logger.error({ err: error }, "Redis health check failed");
  }

  const healthy =
    dependencyStatus.postgres === "ok" && dependencyStatus.redis === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "error",
    ...dependencyStatus,
  });
});

app.get("/metrics", async (_req: Request, res: Response): Promise<void> => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

app.post(
  "/shorten",
  shortenRateLimiter,
  async (
    req: Request<Record<string, never>, unknown, ShortenRequestBody>,
    res: Response,
  ): Promise<void> => {
    const { url } = req.body;

    if (typeof url !== "string" || url.trim().length === 0) {
      res.status(400).json({ error: "Request body must include a non-empty url string" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "The url must be a well-formed URL" });
      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "The url must use http or https" });
      return;
    }

    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      // The sequence-generated id is unique. Encoding it creates a
      // deterministic short code without randomness or retry-on-collision logic.
      const inserted = await client.query<UrlRow>(
        "INSERT INTO urls (long_url) VALUES ($1) RETURNING id",
        [parsedUrl.toString()],
      );

      const id = Number(inserted.rows[0]?.id);
      if (!Number.isSafeInteger(id) || id < 0) {
        throw new Error("Database returned an invalid URL id");
      }

      const shortCode = encodeBase62(id);
      await client.query(
        "UPDATE urls SET short_code = $1 WHERE id = $2",
        [shortCode, inserted.rows[0].id],
      );

      await client.query("COMMIT");
      await urlCache.update(shortCode, {
        longUrl: parsedUrl.toString(),
        urlId: inserted.rows[0].id,
      });
      res.status(201).json({
        shortCode,
        shortUrl: `${configuredBaseUrl.replace(/\/+$/, "")}/${shortCode}`,
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error({ err: rollbackError }, "Failed to roll back URL creation");
        }
      }
      logger.error({ err: error }, "Failed to shorten URL");
      res.status(500).json({ error: "Unable to shorten URL" });
    } finally {
      client?.release();
    }
  },
);

app.get(
  "/:code",
  async (
    req: Request<CodeRouteParams>,
    res: Response,
  ): Promise<void> => {
    const { code } = req.params;

    try {
      let cached = await urlCache.get(code);
      if (!cached) {
        const result = await pool.query<LongUrlRow>(
          "SELECT id, long_url FROM urls WHERE short_code = $1",
          [code],
        );

        const row = result.rows[0];
        if (!row) {
          res.status(404).json({ error: "Short URL not found" });
          return;
        }

        cached = { longUrl: row.long_url, urlId: row.id };
        await urlCache.set(code, cached);
      }

      res.redirect(302, cached.longUrl);
      void logClick(cached.urlId).catch((error: unknown) => {
        logger.error({ err: error }, "Failed to log click");
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to resolve short URL");
      res.status(500).json({ error: "Unable to resolve short URL" });
    }
  },
);

if (require.main === module) {
  app.listen(port, () => {
    logger.info({ port }, "URL shortener listening");
  });
}
