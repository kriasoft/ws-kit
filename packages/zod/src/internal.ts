// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal validation helpers and utilities.
 * Not part of the public API.
 * @internal
 */

import type { ZodType } from "zod";
import { ZOD_PAYLOAD } from "./runtime.js";

/**
 * Helper to extract Zod payload schema from a message schema.
 * @internal
 */
export function getZodPayload(schema: any): ZodType | undefined {
  return schema?.[ZOD_PAYLOAD];
}

/**
 * Helper to validate payload against Zod schema.
 * Always uses safeParse for consistent error handling.
 * Coercion is controlled by schema design (z.coerce.*), not runtime flags.
 * Returns { success: true, data } or { success: false, error }.
 * @internal
 */
export function validatePayload(
  payload: unknown,
  payloadSchema: ZodType | undefined,
): { success: boolean; data?: unknown; error?: any } {
  if (!payloadSchema) {
    // No payload schema defined (message with no payload)
    return { success: true };
  }

  const result = (payloadSchema as any).safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result.error };
}
