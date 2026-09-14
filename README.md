# URL shortener local multi-instance demo

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
