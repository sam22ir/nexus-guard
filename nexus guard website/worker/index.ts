import type { D1Database, Fetcher } from "@cloudflare/workers-types";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const MAX_EMAIL_LEN = 254;

type WaitlistBody = {
  email?: unknown;
  website?: unknown;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/waitlist") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      let body: WaitlistBody;
      try {
        body = (await request.json()) as WaitlistBody;
      } catch {
        return json({ ok: false, error: "Invalid JSON body." }, 400);
      }

      // Honeypot: bots fill this hidden field; humans never do.
      if (typeof body.website === "string" && body.website.length > 0) {
        return json({ ok: true });
      }

      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (email.length === 0 || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
        return json({ ok: false, error: "Enter a valid email address." }, 400);
      }

      try {
        await env.DB.prepare(
          "INSERT INTO signups (email, source) VALUES (?1, 'website')"
        )
          .bind(email)
          .run();
        return json({ ok: true });
      } catch (error) {
        // UNIQUE constraint on email → already signed up. Still a success
        // from the visitor's perspective so addresses can't be enumerated.
        if (
          error instanceof Error &&
          error.message.includes("UNIQUE constraint failed")
        ) {
          return json({ ok: true, duplicate: true });
        }
        return json({ ok: false, error: "Could not save. Try again later." }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
