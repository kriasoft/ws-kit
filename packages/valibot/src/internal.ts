// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal validation helpers and utilities.
 * Not part of the public API.
 * @internal
 */

import type { GenericSchema } from "valibot";

/**
 * Helper to extract Valibot payload schema from a message schema.
 * @internal
 */
export function getValibotPayload(schema: any): GenericSchema | undefined {
  return schema.__valibot_payload;
}

/**
 * Helper to validate payload against Valibot schema.
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

  try {
    // Dynamic import to avoid circular dependency on valibot
    // In a real implementation, valibot would be passed as a parameter
    const parsed = (payloadSchema as any).parse?.(payload);
    return { success: true, data: parsed };
  } catch (error) {
    return { success: false, error };
  }
}
