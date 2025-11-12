// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal validation helpers and utilities.
 * Not part of the public API.
 * @internal
 */

import type { GenericSchema } from "valibot";
import { getValibotPayload as getValibotPayloadFromMetadata } from "./metadata.js";

/**
 * Helper to extract Valibot payload schema from a message schema.
 * Re-exports from metadata.ts for backward compatibility.
 * @internal
 */
export function getValibotPayload(schema: any): GenericSchema | undefined {
  return getValibotPayloadFromMetadata(schema);
}

/**
 * Helper to validate payload against Valibot schema.
 * Always uses safeParse for consistent error handling.
 * Coercion is controlled by schema design, not runtime flags.
 * Returns { success: true, data } or { success: false, error }.
 * @internal
 */
export function validatePayload(
  payload: unknown,
  payloadSchema: GenericSchema | undefined,
): { success: boolean; data?: unknown; error?: any } {
  if (!payloadSchema) {
    // No payload schema defined (message with no payload)
    return { success: true };
  }

  // Use safeParse for consistent error handling
  const result = (payloadSchema as any).safeParse?.(payload);

  if (result?.success) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result?.error };
}
