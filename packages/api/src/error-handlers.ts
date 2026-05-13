import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { PlatformError } from "@pcp/core";

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, "request failed");
    if (err instanceof PlatformError) {
      reply.status(err.httpStatus).send(err.toJson());
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send(new PlatformError("VALIDATION_ERROR", "Request validation failed.", {
        details: { issues: err.issues },
        retryable: false
      }).toJson());
      return;
    }
    const mapped = PlatformError.mapUnknown(err);
    reply.status(mapped.httpStatus).send(mapped.toJson());
  });
}
