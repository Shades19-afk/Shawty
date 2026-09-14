import "../../src/env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { pool } from "../../src/db";
import { app } from "../../src/index";
import { getRedis } from "../../src/redis";

describe("URL shortener routes", () => {
  beforeAll(async () => {
    const schema = await readFile("schema.sql", "utf8");
    await pool.query(schema);
    const redis = await getRedis();
    await redis.flushdb();
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("shortens a valid URL", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/integration-test" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      shortCode: expect.any(String),
      shortUrl: expect.stringContaining("/"),
    });
  });

  it("creates and redirects with an available custom code", async () => {
    const customCode = `my-${Date.now()}`;
    const response = await request(app)
      .post("/shorten")
      .send({
        url: "https://example.com/custom-code",
        customCode,
      });

    expect(response.status).toBe(201);
    expect(response.body.shortCode).toBe(customCode);

    const redirect = await request(app).get(`/${customCode}`).redirects(0);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe("https://example.com/custom-code");
  });

  it("rejects an invalid custom code", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/invalid-code", customCode: "bad code" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("3 to 20 characters");
  });

  it("rejects a custom code that is already in use", async () => {
    const customCode = `taken-${Date.now()}`;
    await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/first", customCode });

    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/second", customCode });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Custom code already in use" });
  });

  it("preserves auto-generated codes when no custom code is provided", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/auto-generated" });

    expect(response.status).toBe(201);
    expect(response.body.shortCode).toEqual(expect.any(String));
    expect(response.body.shortCode).not.toBe("");
  });

  it("rejects an invalid URL", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({ url: "not-a-url" });

    expect(response.status).toBe(400);
  });

  it("redirects for an existing code", async () => {
    const created = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/redirect-test" });

    const response = await request(app)
      .get(`/${created.body.shortCode}`)
      .redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://example.com/redirect-test");
  });

  it("returns 410 and does not log clicks for an expired link", async () => {
    const expiredCode = `expired-${Date.now()}`;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO urls (short_code, long_url, expires_at)
       VALUES ($1, $2, NOW() - interval '1 minute')
       RETURNING id`,
      [expiredCode, "https://example.com/expired"],
    );

    const response = await request(app).get(`/${expiredCode}`).redirects(0);

    expect(response.status).toBe(410);
    expect(response.body).toEqual({ error: "This link has expired" });

    const clicks = await pool.query(
      "SELECT id FROM clicks WHERE url_id = $1",
      [inserted.rows[0].id],
    );
    expect(clicks.rows).toHaveLength(0);
  });

  it("returns 404 for stats on a missing code", async () => {
    const response = await request(app).get("/stats/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Short URL not found" });
  });

  it("returns click totals and daily stats", async () => {
    const created = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/stats-test" });

    const redirects = await Promise.all([
      request(app).get(`/${created.body.shortCode}`).redirects(0),
      request(app).get(`/${created.body.shortCode}`).redirects(0),
      request(app).get(`/${created.body.shortCode}`).redirects(0),
    ]);
    expect(redirects.every((response) => response.status === 302)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    let stats;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stats = await request(app).get(`/stats/${created.body.shortCode}`);
      if (stats.body.totalClicks === 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(stats?.status).toBe(200);
    expect(stats?.body).toMatchObject({
      shortCode: created.body.shortCode,
      longUrl: "https://example.com/stats-test",
      totalClicks: 3,
      clicksByDay: [{ date: today, count: 3 }],
    });
    expect(stats?.body.createdAt).toEqual(expect.any(String));
    expect(stats?.body.expiresAt).toEqual(expect.any(String));
  });

  it("keeps stats available after a link expires", async () => {
    const expiredCode = `stats-expired-${Date.now()}`;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO urls (short_code, long_url, expires_at)
       VALUES ($1, $2, NOW() - interval '1 minute')
       RETURNING id`,
      [expiredCode, "https://example.com/stats-expired"],
    );
    await pool.query(
      "INSERT INTO clicks (url_id, clicked_at) VALUES ($1, NOW())",
      [inserted.rows[0].id],
    );

    const redirect = await request(app).get(`/${expiredCode}`).redirects(0);
    expect(redirect.status).toBe(410);

    const stats = await request(app).get(`/stats/${expiredCode}`);
    expect(stats.status).toBe(200);
    expect(stats.body.totalClicks).toBe(1);
    expect(stats.body.clicksByDay).toHaveLength(1);
  });

  it("returns 404 for a missing code", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.status).toBe(404);
  });

  it("reports healthy dependencies", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      postgres: "ok",
      redis: "ok",
    });
  });
});
