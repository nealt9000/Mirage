// The dev panel and /api/models are for local tuning: on under `npm run dev`
// and `vercel dev`, off on deployments unless VITE_MIRAGE_DEV_TOOLS=1. The
// same variable switches the panel on in the browser build.

export function devToolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !env.VERCEL_ENV || env.VERCEL_ENV === "development" || env.VITE_MIRAGE_DEV_TOOLS === "1";
}
