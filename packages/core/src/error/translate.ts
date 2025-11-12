/**
 * Error translation: map thrown errors → WsKitError.
 * Used by dispatch to ensure all errors are normalized.
 */

import { WsKitError } from "./error";
import type { ErrorCode } from "./codes";

export function translateError(
  err: unknown,
  defaultCode: ErrorCode = "INTERNAL",
): WsKitError {
  if (err instanceof WsKitError) {
    return err;
  }
  return new WsKitError(
    defaultCode,
    err instanceof Error ? err.message : String(err),
  );
}
