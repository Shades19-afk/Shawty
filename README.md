# URL Shortener

[![CI](https://github.com/Shades19-afk/Shawty/actions/workflows/ci.yml/badge.svg)](https://github.com/Shades19-afk/Shawty/actions/workflows/ci.yml)

A compact URL-shortening service demonstrating shared state across replicas, caching, rate limiting, observability, and a simple deployment model.

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

## Design Decisions

### Base62 encoding + DB sequence

The database sequence provides a unique numeric ID, which is encoded in base62 to produce the short code. This is collision-free by construction. Random generation would require collision checks and retries, while hashing would add unnecessary complexity without improving lookup behavior.

Custom short codes are accepted when they use 3-20 letters, digits, hyphens, or underscores. The `short_code` column has a unique database constraint, which remains the source of truth for race-safe conflict handling when concurrent requests choose the same code.

### Redis for cache and rate limiting

Redis provides low-latency shared state for all app replicas. Cache failures fail open to a Postgres fallback so redirects remain available, even though database traffic increases. The rate limiter also fails open: a Redis outage weakens abuse protection temporarily rather than making every shortening request unavailable.

### Async click logging

Redirects do not wait for click logging. The click is recorded in the background so analytics cannot add latency to the user-facing redirect. At higher volume, this would become a queue-backed event pipeline.

### Multiple replicas behind nginx

Three replicas provide horizontal capacity and avoid making one process the only serving path. Redis must be shared: without it, each replica would have an isolated cache and rate-limit counter, producing inconsistent behavior as nginx sends requests to different instances.

### Observability

`/health` checks Postgres and Redis availability, `/metrics` exposes Prometheus counters and latency histograms, and pino emits structured JSON request logs. Together these provide dependency status, service-level trends, and enough request context for debugging.

## Running Locally

### Docker Compose

Start Postgres, Redis, three app replicas, and nginx:

```bash
docker compose up --build
```

The public endpoint is `http://localhost:8080`.

Create and resolve a short URL:

```bash
curl -i -X POST http://localhost:8080/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

curl -i http://localhost:8080/<shortCode>
```

To reset the database and Redis volumes:

```bash
docker compose down -v
docker compose up --build
```

### Manual local setup

Create a `.env` file with:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shortener
REDIS_URL=redis://localhost:6379
PORT=3000
BASE_URL=http://localhost:3000
```

Then install and run:

```bash
npm install
npm run build
npm run dev
```

## Testing

Unit tests mock Redis and validate service behavior quickly and deterministically. Integration tests use real Postgres and Redis to verify database, cache, rate-limit, and redirect behavior against actual dependencies.

Run unit tests:

```bash
npm run test:unit
```

Run integration tests with the test Compose override:

Start the test dependencies:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d postgres redis
```

Create a `.env.test` file with:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/shortener
REDIS_URL=redis://localhost:6380
```

Then run:

```bash
npm run test:integration
```

Run both suites:

```bash
npm test
```

## CI/CD

The [GitHub Actions workflow](./.github/workflows/ci.yml) runs on pushes and pull requests targeting `main`. It installs dependencies with Node.js 22, compiles the TypeScript project, runs unit tests, and runs integration tests against Postgres 16 and Redis 7 service containers.

## What I'd Do Next

- Kubernetes or a managed container platform for rolling deployments and autoscaling
- CDN or edge caching for high-volume redirects
- A message queue for click events at higher analytics volume
- Link expiration
- Per-user quotas, ownership, deletion, and administrative controls

These are intentionally outside the current scope; the current build focuses on a small, testable service and the core distributed-systems trade-offs.
