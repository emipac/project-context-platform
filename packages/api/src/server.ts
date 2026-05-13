import Fastify from "fastify";
import cors from "@fastify/cors";
import { createAppServices } from "@pcp/infra";
import { registerErrorHandlers } from "./error-handlers.js";
import { registerRoutes } from "./routes.js";

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  registerErrorHandlers(app);
  await registerRoutes(app, createAppServices());
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.PCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.PCP_PORT ?? 4318);
  if (host !== "127.0.0.1" && host !== "localhost" && process.env.ALLOW_REMOTE_BIND !== "true") {
    throw new Error("Authentication is mandatory off localhost; set ALLOW_REMOTE_BIND=true and configure auth before remote binding.");
  }
  const app = await buildServer();
  await app.listen({ host, port });
}
