/**
 * Error codes (gRPC-style): machine-readable error classification.
 * Each code has retryability metadata + default message.
 */

export type ErrorCode =
  | "INTERNAL"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "ABORTED"
  | "DEADLINE_EXCEEDED"
  | "RESOURCE_EXHAUSTED"
  | "INVALID_ARGUMENT"
  | "UNAVAILABLE"
  | "STALE_CONNECTION";

export interface WsKitErrorData {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

const ERROR_METADATA: Record<ErrorCode, { message: string; retryable: boolean }> = {
  INTERNAL: { message: "Internal server error", retryable: false },
  BAD_REQUEST: { message: "Bad request", retryable: false },
  UNAUTHORIZED: { message: "Unauthorized", retryable: false },
  FORBIDDEN: { message: "Forbidden", retryable: false },
  NOT_FOUND: { message: "Not found", retryable: false },
  ALREADY_EXISTS: { message: "Already exists", retryable: false },
  ABORTED: { message: "Aborted", retryable: true },
  DEADLINE_EXCEEDED: { message: "Deadline exceeded", retryable: true },
  RESOURCE_EXHAUSTED: { message: "Resource exhausted", retryable: true },
  INVALID_ARGUMENT: { message: "Invalid argument", retryable: false },
  UNAVAILABLE: { message: "Unavailable", retryable: true },
  STALE_CONNECTION: { message: "Connection stale", retryable: false },
};

export function getErrorMetadata(code: ErrorCode) {
  return ERROR_METADATA[code];
}
