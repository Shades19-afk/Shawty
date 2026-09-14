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

  it("creates and redirects with an available custom code", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({
        url: "https://example.com/custom-code",
        customCode: "my-link",
      });

    expect(response.status).toBe(201);
    expect(response.body.shortCode).toBe("my-link");

    const redirect = await request(app).get("/my-link").redirects(0);
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
    await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/first", customCode: "taken-code" });

    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com/second", customCode: "taken-code" });

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
