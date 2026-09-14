import "../../src/env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { pool } from "../../src/db";
import { app } from "../../src/index";

describe("URL shortener routes", () => {
  beforeAll(async () => {
    const schema = await readFile("schema.sql", "utf8");
    await pool.query(schema);
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
