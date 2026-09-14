import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRedis } = vi.hoisted(() => ({
  getRedis: vi.fn(),
}));

vi.mock("../../src/redis", () => ({ getRedis }));

import { urlCache } from "../../src/cache";

describe("urlCache", () => {
  const redis = {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  const value = { longUrl: "https://example.com", urlId: "42" };

  beforeEach(() => {
    vi.clearAllMocks();
    getRedis.mockResolvedValue(redis);
    redis.get.mockResolvedValue(JSON.stringify(value));
    redis.set.mockResolvedValue("OK");
    redis.del.mockResolvedValue(1);
  });

  it("gets a cached URL", async () => {
    await expect(urlCache.get("abc")).resolves.toEqual(value);
    expect(redis.get).toHaveBeenCalledWith("url:abc");
  });

  it("returns a miss for an absent cache entry", async () => {
    redis.get.mockResolvedValue(null);
    await expect(urlCache.get("missing")).resolves.toBeUndefined();
  });

  it("treats Redis read failures as cache misses", async () => {
    redis.get.mockRejectedValue(new Error("Redis unavailable"));
    await expect(urlCache.get("abc")).resolves.toBeUndefined();
  });

  it("sets and updates cached URLs", async () => {
    await urlCache.set("abc", value);
    expect(redis.set).toHaveBeenCalledWith(
      "url:abc",
      JSON.stringify(value),
      "EX",
      3600,
    );

    await urlCache.update("abc", value);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it("swallows Redis write failures", async () => {
    redis.set.mockRejectedValue(new Error("Redis unavailable"));
    await expect(urlCache.set("abc", value)).resolves.toBeUndefined();
  });

  it("invalidates a cached URL", async () => {
    await urlCache.invalidate("abc");
    expect(redis.del).toHaveBeenCalledWith("url:abc");
  });

  it("swallows Redis invalidation failures", async () => {
    redis.del.mockRejectedValue(new Error("Redis unavailable"));
    await expect(urlCache.invalidate("abc")).resolves.toBeUndefined();
  });
});
