/**
 * ID generation: client IDs, correlation IDs, trace IDs.
 */

import { randomBytes } from "crypto";

export function generateClientId(): string {
  return `client_${randomBytes(8).toString("hex")}`;
}

export function generateCorrelationId(): string {
  return `corr_${randomBytes(8).toString("hex")}`;
}

export function generateTraceId(): string {
  return `trace_${randomBytes(12).toString("hex")}`;
}
