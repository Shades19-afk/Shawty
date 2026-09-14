# URL Shortener

[![CI](https://github.com/Shades19-afk/Shawty/actions/workflows/ci.yml/badge.svg)](https://github.com/Shades19-afk/Shawty/actions/workflows/ci.yml)

A compact URL-shortening service built to demonstrate production-minded engineering choices: shared state across replicas, caching, rate limiting, observability, and a simple deployment model. The app accepts a long URL, generates a short code, and redirects users without making the redirect path itself expensive or unreliable.

## Architecture

```text
Client
  |
  v
Nginx (round robin)
  |
  +--> app replica 1
  +--> app replica 2
  +--> app replica 3
      |      |
      |      +--> Redis (shared cache + distributed rate limiting)
      |
      +--> Postgres (urls + clicks metadata)
```

The routing layer sits in front of three identical app instances, while Redis is the shared coordination layer. That matters for both cache correctness and rate-limit enforcement when multiple processes are serving traffic.

## Design Decisions

### Base62 encoding + DB sequence instead of random generation or hashing

I use a database sequence to assign a unique numeric ID to each URL, then encode that ID in base62. This is collision-free by construction because the ID is already unique, and the short code is just a deterministic representation of that ID. A random strategy would require collision detection and retries; a hash-based approach would trade away the simplicity of direct lookup and would not naturally preserve the monotonic sequence semantics that make the ID generation clean and predictable.

### Redis for cache and rate limiting, and fail-open behavior

Redis is the right fit for both read-heavy caching and distributed, low-latency rate limits because it is fast, simple, and already shared across all replicas. For the cache, a miss falls through to Postgres and a write is retried later if needed; that keeps redirect availability high even during a Redis outage. For the rate limiter, the service chooses fail-open: if Redis is unavailable, it logs the failure and allows the request instead of turning a dependency issue into a blanket "all shorten requests are down" outage. That is a deliberate trade-off: the system stays available, but abuse protection is temporarily weaker until Redis recovers.

### Async fire-and-forget click logging

The redirect handler does not wait for click logging before sending the browser to the destination URL. The click is recorded in the background with a fire-and-forget helper, which keeps the user-facing redirect latency low and avoids turning analytics into a critical path. In a higher-volume product, that would later evolve into a queue-based pipeline, but this version keeps the data collection simple while preserving redirect speed.

### Multiple app replicas behind nginx

Three app instances behind nginx give the service horizontal scaling and better resilience than a single process. Nginx distributes requests across replicas, so no single instance is the choke point. The catch is that the replicas must share state: the cache and rate limiter cannot be process-local, because a request may hit app1 for creation and app2 for lookup; without shared Redis, one replica would not know about the other replica's cached data or rate-limit counters, which would create inconsistent behavior and break the illusion of a single service.

### Observability: health checks, metrics, and structured logs

I added health endpoints for dependency checks, Prometheus metrics for traffic and latency, and structured JSON logs for request-level visibility. This makes the service debuggable in a production-like environment without over-engineering it: health tells me whether Postgres and Redis are up, metrics show whether the app is actually receiving and serving traffic, and logs give enough context to trace requests by replica, route, status, and duration. In a larger system, this is the foundation for alerting, dashboards, and incident response.

## Running Locally

### Fastest path: Docker Compose

This project is designed to run as a multi-instance stack with Postgres, Redis, app replicas, and nginx in front.

```bash
docker compose up --build
```

The app is exposed at `http://localhost:8080`.

To create a short URL:

```bash
curl -i -X POST http://localhost:8080/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Then resolve the returned short code:

```bash
curl -i http://localhost:8080/<shortCode>
```

To reset the environment completely:

```bash
docker compose down -v
docker compose up --build
```

### Manual local setup

If you want to run the app directly instead of the Compose stack:

```bash
cp .env.example .env
npm install
```

Set your environment variables in `.env` to point at a local Postgres and Redis instance, then start the app:

```bash
npm run build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shortener \
REDIS_URL=redis://localhost:6379 \
PORT=3000 \
BASE_URL=http://localhost:3000 \
npm run dev
```

You can also run the app with the repository's Docker Compose stack while keeping the same service-level environment values for the app containers.

## Testing

The project has two distinct test layers:

- Unit tests validate service behavior in isolation, with Redis mocked so tests stay fast and deterministic.
- Integration tests exercise the real Postgres and Redis behavior to verify the app works with actual shared dependencies.

Run the unit suite:

```bash
npm run test:unit
```

Run the integration suite:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d postgres redis
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/shortener \
REDIS_URL=redis://localhost:6380 \
npm run test:integration
```

Run both suites together:

```bash
npm test
```

The integration tests are the useful guardrail for behavior that depends on real data stores and connection semantics; the unit tests are the fast feedback loop when iterating on logic and edge cases.

## CI/CD

The GitHub Actions pipeline checks the project on every push and pull request to `main`.

The workflow runs three jobs:

- Build: TypeScript compile and dependency install
- Unit Tests: mocked test suite against the app logic
- Integration Tests: Postgres 16 and Redis 7 service containers running `schema.sql` to verify end-to-end database behavior

This is a good, realistic baseline for a small backend project: it validates that the service compiles, behaves in isolation, and still works with the required backing services.

## What I'd Do Next

These are the realistic next steps I would ship before considering this a production-grade redirect service:

- Kubernetes or a managed container orchestrator for rolling deployments, autoscaling, and health-based routing
- CDN or edge caching for frequent redirect traffic to reduce origin load
- A message queue for click events once analytics volume grows beyond a single Postgres write path
- Custom short codes and optional link expiration for marketing and campaign use cases
- More explicit operational safeguards such as per-user quotas, admin controls, and a cleaner audit trail for URL ownership and deletion

The current build is intentionally opinionated: it is simple, testable, and demonstrates the core distributed systems trade-offs without pretending to solve the full operational complexity of a large-scale URL platform.

