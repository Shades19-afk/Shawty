/*
 * Usage:
 *   npm run dev
 *   curl -X POST http://localhost:3000/shorten ^
 *     -H "Content-Type: application/json" ^
 *     -d "{\"url\":\"https://example.com\"}"
 *   curl -i http://localhost:3000/<shortCode>
 */

import "dotenv/config";

import express, { type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { encodeBase62 } from "./base62";
import { urlCache } from "./cache";
import { logClick } from "./clicks";
import { pool } from "./db";
import { createShortenRateLimiter } from "./rateLimit";

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

const app = express();
const port = Number(process.env.PORT ?? 3000);
const configuredBaseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

app.use(express.json());

const shortenRateLimiter = createShortenRateLimiter(
  Number(process.env.SHORTEN_RATE_LIMIT_WINDOW_MS ?? 60_000),
  Number(process.env.SHORTEN_RATE_LIMIT_MAX ?? 10),
);

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
          console.error("Failed to roll back URL creation:", rollbackError);
        }
      }
      console.error("Failed to shorten URL:", error);
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
        console.error("Failed to log click:", error);
      });
    } catch (error) {
      console.error("Failed to resolve short URL:", error);
      res.status(500).json({ error: "Unable to resolve short URL" });
    }
  },
);

app.listen(port, () => {
  console.log(`URL shortener listening on port ${port}`);
});
