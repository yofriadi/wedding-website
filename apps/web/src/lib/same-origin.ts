/**
 * Same-origin check that survives a TLS-terminating reverse proxy.
 *
 * The documented production deployment (`docker-compose.caddy.yml` +
 * `Caddyfile.example`) terminates HTTPS in Caddy and forwards plain HTTP to the
 * node adapter. Astro's `createRequestFromNodeRequest` derives the scheme from
 * `req.socket.encrypted` and passes `void 0` for the forwarded protocol, so
 * `request.url` comes out as `http://<host>` while the browser's `Origin` is
 * `https://<host>`. A naive `origin === new URL(request.url).origin` comparison
 * therefore 403s EVERY legitimate same-origin POST in production — which is
 * exactly the failure this helper exists to avoid. (Astro's sibling
 * `createRequest` does honour `x-forwarded-proto`, but the node adapter's
 * standalone handler does not call it.)
 *
 * Trusting `X-Forwarded-*` here is safe, and this was verified rather than
 * assumed. Spoofing them is not a privilege escalation, for three independent
 * reasons:
 *
 *   1. A BROWSER cannot set them cross-site. They are not CORS-safelisted request
 *      headers, so a cross-site `fetch` would need a preflight, which fails
 *      because these endpoints send no CORS headers; a cross-site form cannot add
 *      headers at all.
 *   2. The identity never arrives anyway: the invite cookie is `SameSite=Lax`,
 *      which withholds it on cross-site POSTs.
 *   3. In the documented HTTPS deployment the app is bound to
 *      `127.0.0.1:4321` (`docker-compose.caddy.yml`, `ports: !override`), so only
 *      Caddy can reach it and its `X-Forwarded-*` values are authoritative.
 *
 * The only caller who can spoof them is a direct non-browser client — which can
 * equally set `Origin`, and which would already need the victim's cookie value,
 * at which point SameSite is irrelevant. Empirically confirmed: a request with
 * `Origin: https://evil.example` is refused, and the same request plus a matching
 * spoofed `X-Forwarded-Proto`/`-Host` is accepted — the spoofer gained nothing it
 * did not already have.
 *
 * `x-forwarded-host` is load-bearing only for a proxy that rewrites `Host`
 * (nginx's default `proxy_set_header Host $proxy_host`); Caddy, Traefik, and
 * cloudflared all preserve it. The cleaner long-term fix is a single configured
 * public origin (`site:` in `astro.config.mjs`, currently unset) compared against
 * `Origin`, which would remove header trust entirely — that needs a deployment
 * decision, since the domain is per-couple.
 *
 * NOTE: this helper IS the origin check — there is no second control behind it.
 * Astro's framework `security.checkOrigin` is DISABLED in `astro.config.mjs`
 * precisely because it performs the naive comparison above and therefore 403s
 * every legitimate form-like and bodiless POST behind a TLS-terminating proxy. So
 * if a cookie-authenticated mutating endpoint forgets to call this, nothing else
 * catches the request. `tests/origin-guard.spec.ts` exists to make that omission
 * fail the build; keep it passing.
 *
 * Deliberate looseness worth knowing about: the socket-derived origin is compared
 * FIRST, so behind the TLS proxy an `Origin: http://<host>` is accepted — a
 * scheme-downgraded same-origin. Not exploitable in the documented topology
 * (Caddy's site block auto-redirects :80, and the app binds to 127.0.0.1:4321 so
 * only Caddy can reach it), and it is exact parity with the framework's own
 * behaviour, so it is not a regression. The stricter form — once forwarded headers
 * are present, compare only against the reconstructed public origin — is what a
 * configured `site:` would give for free.
 */
/**
 * Uniform 403 for a cross-origin mutating request.
 *
 * One shape across every cookie-authenticated POST, so a client — or the
 * architecture test that guards this invariant — does not have to special-case
 * which endpoint it hit. `guest-photos` previously returned an empty body here;
 * no legitimate caller ever sees this response, so unifying it costs nothing and
 * makes the guard greppable.
 */
export function crossOriginPostForbidden(): Response {
  return new Response(JSON.stringify({ error: "cross_origin_post" }), {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  // No Origin header means a non-browser client (curl, a server-side caller) or a
  // request the browser does not annotate. Callers decide what that means; this
  // helper only judges an Origin that was actually presented.
  if (origin === null) return true;

  const url = new URL(request.url);
  if (origin === url.origin) return true;

  // Behind a proxy the socket scheme is http while the client-facing scheme is
  // https. Reconstruct the public origin from the forwarded headers.
  const proto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const host = firstForwardedValue(request.headers.get("x-forwarded-host")) ?? url.host;
  return proto !== null && origin === `${proto}://${host}`;
}

// A proxy chain yields a comma-separated list; the client-facing value is first.
function firstForwardedValue(value: string | null): string | null {
  if (value === null) return null;
  const head = value.split(",")[0]?.trim();
  return head ? head : null;
}
