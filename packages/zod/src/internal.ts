// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal validation helpers and utilities.
 * Not part of the public API.
 * @internal
 */

import type { ZodType } from "zod";

/**
 * Helper to extract Zod payload schema from a message schema.
 * @internal
 */
export function getZodPayload(schema: any): ZodType | undefined {
  return schema.__zod_payload;
}

/**
 * Helper to validate payload against Zod schema.
 * Returns { success: true, data } or { success: false, error }.
 * @internal
 */
export function validatePayload(
  payload: unknown,
  payloadSchema: ZodType | undefined,
  coerce?: boolean,
): { success: boolean; data?: unknown; error?: any } {
  if (!payloadSchema) {
    // No payload schema defined (message with no payload)
    return { success: true };
  }

  const parseMethod = coerce ? "parseAsync" : "safeParse";
  const result = (payloadSchema as any)[parseMethod](payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result.error };
}
