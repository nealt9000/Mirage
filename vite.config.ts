import type { IncomingMessage } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { POST as linksPost } from "./api/links";
import { GET as modelsGet } from "./api/models";
import { POST as pagePost } from "./api/page";

type Handler = (req: Request) => Promise<Response>;

// Dev-only: serve the api/ functions from the Vite server so `npm run dev`
// behaves like Vercel. Handlers are Web-standard (Request → Response).
const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  "/api/page": { POST: pagePost },
  "/api/links": { POST: linksPost },
  "/api/models": { GET: modelsGet },
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function apiDevServer(): Plugin {
  return {
    name: "api-dev-server",
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), "");
      for (const key of ["OPENROUTER_API_KEY", "MIRAGE_ALLOWED_MODELS"]) {
        if (env[key] && !process.env[key]) process.env[key] = env[key];
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = ROUTES[(req.url ?? "").split("?")[0]];
        if (!route) return next();
        const handler = route[req.method ?? "GET"];
        if (!handler) {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const hasBody = req.method !== "GET" && req.method !== "HEAD";
          const ac = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) ac.abort();
          });
          const response = await handler(
            new Request(`http://localhost${req.url}`, {
              method: req.method,
              headers: { "content-type": req.headers["content-type"] ?? "application/json" },
              body: hasBody ? await readBody(req) : undefined,
              signal: ac.signal,
            })
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          console.error("[api-dev-server]", e);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  plugins: [apiDevServer()],
});
