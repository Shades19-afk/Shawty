# URL shortener local multi-instance demo

[![CI](https://github.com/OWNER/REPOSITORY/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPOSITORY/actions/workflows/ci.yml)

This Compose setup runs Postgres, Redis, three URL-shortener app instances,
and an nginx round-robin proxy. Redis is the shared state that makes
multi-instance cache and rate-limit behavior meaningful.

## Start the stack

```sh
docker compose up --build
```

The public endpoint is `http://localhost:8080`. Postgres applies
[`schema.sql`](./schema.sql) automatically the first time its volume is
created. To re-run initialization from scratch:

```sh
docker compose down -v
docker compose up --build
```

## Verify shared behavior

Create a short URL through nginx:

```sh
curl -i -X POST http://localhost:8080/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Resolve the returned code repeatedly:

```sh
curl -i http://localhost:8080/<shortCode>
```

nginx round-robins these requests across `app1`, `app2`, and `app3`.
All instances use the same Redis cache, so a code populated while the
shorten request reaches one instance can be resolved by another without
requiring a process-local cache entry. The async click rows are written to
the same Postgres database as well.

To verify the shared rate limit, send more than ten shorten requests within
one minute. Requests receive HTTP 429 even as nginx distributes them across
the three app instances:

```sh
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:8080/shorten \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"https://example.com/$i\"}"
done
```

The Compose services use container DNS names (`postgres` and `redis`) rather
than `localhost`, while the host-facing URL remains `http://localhost:8080`.

## Observability

Each app replica exposes health and Prometheus metrics through nginx:

```sh
curl http://localhost:8080/health
curl http://localhost:8080/metrics
```

`/health` returns HTTP 200 only when both Postgres and Redis are reachable.
Otherwise it returns HTTP 503 and identifies the dependency that failed.
Requests are emitted as one JSON log line with the method, path, status,
response time, and replica name (`app1`, `app2`, or `app3`).

The `/metrics` response includes:

- `url_shortener_requests_total`: request count by route, status code, and replica.
- `url_shortener_response_duration_seconds`: response-time histogram by route,
  status code, and replica.
- `url_shortener_cache_hits_total` and `url_shortener_cache_misses_total`:
  Redis cache outcomes for short-code lookups.
- `url_shortener_rate_limit_rejections_total`: rejected `POST /shorten`
  requests.

In production, a Prometheus server would scrape `/metrics` and Grafana would
visualize the resulting dashboards and alerts. A Prometheus/Grafana deployment,
long-term metrics storage, and distributed tracing are out of scope for this
demo.

## Tests

Install dependencies and run the fast unit tests with:

```sh
npm install
npm run test:unit
```

Unit tests mock Redis and do not require Docker services. Integration tests use
the real Postgres and Redis services. Start them with the test Compose override
so they are reachable from the host:

```sh
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d postgres redis
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/shortener"
$env:REDIS_URL="redis://localhost:6380"
npm run test:integration
```

Run both suites with `npm test`. The integration tests create short URLs in
the configured test database and do not require the application containers or
nginx to be running.

## Continuous integration

The [GitHub Actions CI workflow](./.github/workflows/ci.yml) runs on pushes and
pull requests targeting `main`. It uses Node.js 22, caches npm downloads, and
runs the TypeScript build, mocked unit tests, and integration tests against
Postgres 16 and Redis 7 service containers. The integration tests initialize
`schema.sql` automatically, so CI does not depend on the local Compose port
override.

The badge at the top of this README shows the latest workflow status. Replace
`OWNER/REPOSITORY` in the badge URL with the GitHub owner and repository name
after creating the remote repository.

This workspace currently has no Git remote configured. To publish it and
trigger the workflow:

```sh
git init
git add .
git commit -m "Add CI pipeline"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repository>.git
git push -u origin main
```

Create the empty GitHub repository first, then replace the placeholder remote
and badge values above. Once pushed, check the **Actions** tab for the Build,
Unit Tests, and Integration Tests jobs.
