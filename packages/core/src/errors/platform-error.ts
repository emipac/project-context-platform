import type { StructuredPlatformError } from "../domain/types.js";

export const ErrorCodes = {
  PROJECT_NOT_FOUND: { httpStatus: 404, retryable: false, message: "Project workspace was not found." },
  CONFIRMATION_REQUIRED: { httpStatus: 400, retryable: false, message: "Destructive operation requires explicit confirmation." },
  PROJECT_ALREADY_EXISTS: { httpStatus: 409, retryable: false, message: "Project workspace already exists." },
  INVALID_ROOT: { httpStatus: 400, retryable: false, message: "Workspace root is invalid." },
  CONFIG_INVALID: { httpStatus: 400, retryable: false, message: "Project configuration is invalid." },
  VALIDATION_ERROR: { httpStatus: 400, retryable: false, message: "Request validation failed." },
  INGESTION_CONFLICT: { httpStatus: 409, retryable: false, message: "Ingestion request conflicts with current policy." },
  MEMORY_APPROVAL_REQUIRED: { httpStatus: 403, retryable: false, message: "High-risk memory write requires approval." },
  BACKEND_UNAVAILABLE: { httpStatus: 503, retryable: true, message: "A backend service is unavailable." },
  INTERNAL_ERROR: { httpStatus: 500, retryable: false, message: "An internal error occurred." }
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class PlatformError extends Error {
  readonly code: ErrorCode | string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;
  readonly project_id: string | null;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode | string,
    message?: string,
    options: {
      httpStatus?: number;
      details?: Record<string, unknown>;
      project_id?: string | null;
      retryable?: boolean;
    } = {}
  ) {
    const known = ErrorCodes[code as ErrorCode];
    super(message ?? known?.message ?? "Platform error.");
    this.name = "PlatformError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? known?.httpStatus ?? 500;
    this.details = options.details ?? {};
    this.project_id = options.project_id ?? null;
    this.retryable = options.retryable ?? known?.retryable ?? false;
  }

  toJson(): StructuredPlatformError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      project_id: this.project_id,
      retryable: this.retryable
    };
  }

  static mapUnknown(err: unknown): PlatformError {
    if (err instanceof PlatformError) return err;
    return new PlatformError("INTERNAL_ERROR");
  }
}
