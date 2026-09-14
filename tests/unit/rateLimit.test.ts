import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const { getRedis } = vi.hoisted(() => ({
  getRedis: vi.fn(),
}));

vi.mock("../../src/redis", () => ({ getRedis }));

import { createShortenRateLimiter } from "../../src/rateLimit";

describe("createShortenRateLimiter", () => {
  const redis = { eval: vi.fn() };
  const request = { ip: "127.0.0.1" } as Request;
  const response = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getRedis.mockResolvedValue(redis);
    redis.eval.mockResolvedValue(1);
  });

  it("allows requests under the limit", async () => {
    const middleware = createShortenRateLimiter(60_000, 10);
    middleware(request, response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(response.status).not.toHaveBeenCalled();
  });

  it("rejects requests over the limit", async () => {
    redis.eval.mockResolvedValue(11);
    const middleware = createShortenRateLimiter(60_000, 10);
    middleware(request, response, next);
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(429));
    expect(next).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      error: "Too many shortening requests; please try again later",
    });
  });

  it("fails open when Redis is unavailable", async () => {
    getRedis.mockRejectedValue(new Error("Redis unavailable"));
    const middleware = createShortenRateLimiter(60_000, 10);
    middleware(request, response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(response.status).not.toHaveBeenCalled();
  });
});
