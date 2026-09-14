import { pool } from "./db";

/**
 * Records a successful redirect without making the redirect wait for analytics.
 *
 * Fire-and-forget is appropriate here because click analytics are secondary:
 * an occasional lost event is preferable to delaying or failing the user's
 * redirect. A durable queue can be added later if analytics become critical.
 */
export async function logClick(urlId: string): Promise<void> {
  await pool.query(
    "INSERT INTO clicks (url_id, clicked_at) VALUES ($1, NOW())",
    [urlId],
  );
}
