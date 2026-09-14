"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimitRejectCounter = exports.cacheMissCounter = exports.cacheHitCounter = exports.responseDuration = exports.requestCounter = exports.metricsRegistry = exports.logger = exports.replica = void 0;
exports.recordRequest = recordRequest;
exports.recordCacheHit = recordCacheHit;
exports.recordCacheMiss = recordCacheMiss;
exports.recordRateLimitRejection = recordRateLimitRejection;
const node_os_1 = __importDefault(require("node:os"));
const pino_1 = __importDefault(require("pino"));
const prom_client_1 = require("prom-client");
exports.replica = process.env.HOSTNAME ?? node_os_1.default.hostname();
exports.logger = (0, pino_1.default)({ base: { replica: exports.replica } });
exports.metricsRegistry = new prom_client_1.Registry();
exports.requestCounter = new prom_client_1.Counter({
    name: "url_shortener_requests_total",
    help: "Total number of HTTP requests handled",
    labelNames: ["route", "status_code", "replica"],
    registers: [exports.metricsRegistry],
});
exports.responseDuration = new prom_client_1.Histogram({
    name: "url_shortener_response_duration_seconds",
    help: "HTTP response duration in seconds",
    labelNames: ["route", "status_code", "replica"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [exports.metricsRegistry],
});
exports.cacheHitCounter = new prom_client_1.Counter({
    name: "url_shortener_cache_hits_total",
    help: "Number of short-code lookups served from the Redis cache",
    labelNames: ["replica"],
    registers: [exports.metricsRegistry],
});
exports.cacheMissCounter = new prom_client_1.Counter({
    name: "url_shortener_cache_misses_total",
    help: "Number of short-code lookups not served from the Redis cache",
    labelNames: ["replica"],
    registers: [exports.metricsRegistry],
});
exports.rateLimitRejectCounter = new prom_client_1.Counter({
    name: "url_shortener_rate_limit_rejections_total",
    help: "Number of shorten requests rejected by the rate limiter",
    labelNames: ["replica"],
    registers: [exports.metricsRegistry],
});
function recordRequest(route, statusCode, durationSeconds) {
    const labels = {
        route,
        status_code: String(statusCode),
        replica: exports.replica,
    };
    exports.requestCounter.inc(labels);
    exports.responseDuration.observe(labels, durationSeconds);
}
function recordCacheHit() {
    exports.cacheHitCounter.inc({ replica: exports.replica });
}
function recordCacheMiss() {
    exports.cacheMissCounter.inc({ replica: exports.replica });
}
function recordRateLimitRejection() {
    exports.rateLimitRejectCounter.inc({ replica: exports.replica });
}
