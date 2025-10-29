// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { ZodValidatorAdapter } from "./adapter";
import type { ValidatorAdapter } from "@ws-kit/core";

/**
 * Creates a Zod validator adapter for the WebSocket router.
 *
 * For most applications, use the typed router factory `createRouter()` instead,
 * which provides full TypeScript type inference in message handlers. The bare
 * validator adapter is useful only when building custom router wrappers or when
 * you specifically need to work with the core router directly.
 *
 * @returns A ValidatorAdapter configured with Zod
 *
 * @example
 * ```typescript
 * // Recommended: Use typed router factory for full type inference
 * import { createRouter, createMessageSchema } from "@ws-kit/zod";
 * import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
 * import { z } from "zod";
 *
 * const { messageSchema } = createMessageSchema(z);
 * const PingSchema = messageSchema("PING", { text: z.string() });
 *
 * const router = createRouter({
 *   platform: createBunAdapter(),
 * });
 *
 * router.on(PingSchema, (ctx) => {
 *   console.log(ctx.payload.text); // ← type is inferred
 * });
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 *
 * @example
 * ```typescript
 * // Advanced: Direct validator usage (bare metal)
 * import { zodValidator } from "@ws-kit/zod";
 * import { WebSocketRouter } from "@ws-kit/core";
 *
 * const router = new WebSocketRouter({
 *   validator: zodValidator(),
 * });
 * // Note: handler payloads are not type-safe without the factory wrapper
 * ```
 */
export default function zodValidator(): ValidatorAdapter {
  return new ZodValidatorAdapter();
}
