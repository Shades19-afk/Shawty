import os from "node:os";
import pino from "pino";
import {
  Counter,
  Histogram,
  Registry,
} from "prom-client";

export const replica = process.env.HOSTNAME ?? os.hostname();
export const logger = pino({ base: { replica } });
export const metricsRegistry = new Registry();

export const requestCounter = new Counter({
  name: "url_shortener_requests_total",
  help: "Total number of HTTP requests handled",
  labelNames: ["route", "status_code", "replica"],
  registers: [metricsRegistry],
});

export const responseDuration = new Histogram({
  name: "url_shortener_response_duration_seconds",
  help: "HTTP response duration in seconds",
  labelNames: ["route", "status_code", "replica"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const cacheHitCounter = new Counter({
  name: "url_shortener_cache_hits_total",
  help: "Number of short-code lookups served from the Redis cache",
  labelNames: ["replica"],
  registers: [metricsRegistry],
});

export const cacheMissCounter = new Counter({
  name: "url_shortener_cache_misses_total",
  help: "Number of short-code lookups not served from the Redis cache",
  labelNames: ["replica"],
  registers: [metricsRegistry],
});

export const rateLimitRejectCounter = new Counter({
  name: "url_shortener_rate_limit_rejections_total",
  help: "Number of shorten requests rejected by the rate limiter",
  labelNames: ["replica"],
  registers: [metricsRegistry],
});

export function recordRequest(
  route: string,
  statusCode: number,
  durationSeconds: number,
): void {
  const labels = {
    route,
    status_code: String(statusCode),
    replica,
  };
  requestCounter.inc(labels);
  responseDuration.observe(labels, durationSeconds);
}

export function recordCacheHit(): void {
  cacheHitCounter.inc({ replica });
}

export function recordCacheMiss(): void {
  cacheMissCounter.inc({ replica });
}

export function recordRateLimitRejection(): void {
  rateLimitRejectCounter.inc({ replica });
}
