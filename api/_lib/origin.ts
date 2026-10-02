// Cheap deterrent against other sites (and casual scripts) calling the API:
// POSTs must carry an Origin whose host is this deployment's host, or one
// listed in MIRAGE_ALLOWED_ORIGINS. Not a security boundary (Origin can be
// forged outside a browser); signatures and rate limits do the real work.

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  const origin = hostOf(req.headers.get("origin"));
  if (!origin) return false;
  const own = [hostOf(req.url), req.headers.get("x-forwarded-host"), req.headers.get("host")];
  const extra = (env.MIRAGE_ALLOWED_ORIGINS ?? "").split(",").map((s) => hostOf(s.trim()));
  return [...own, ...extra].some((h) => h === origin);
}
