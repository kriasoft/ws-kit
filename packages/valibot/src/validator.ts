// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { ValibotValidatorAdapter } from "./adapter";
import type { ValidatorAdapter } from "@ws-kit/core";

/**
 * Creates a Valibot validator adapter for the WebSocket router.
 *
 * For most applications, use the typed router factory `createValibotRouter()` instead,
 * which provides full TypeScript type inference in message handlers. The bare
 * validator adapter is useful only when building custom router wrappers or when
 * you specifically need to work with the core router directly.
 *
 * @returns A ValidatorAdapter configured with Valibot
 *
 * @example
 * ```typescript
 * // Recommended: Use typed router factory for full type inference
 * import { createValibotRouter, createMessageSchema } from "@ws-kit/valibot";
 * import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
 * import * as v from "valibot";
 *
 * const { messageSchema } = createMessageSchema(v);
 * const PingSchema = messageSchema("PING", { text: v.string() });
 *
 * const router = createValibotRouter({
 *   platform: createBunAdapter(),
 * });
 *
 * router.onMessage(PingSchema, (ctx) => {
 *   console.log(ctx.payload.text); // ← type is inferred
 * });
 *
 * const { fetch, websocket } = createBunHandler(router._core);
 * ```
 *
 * @example
 * ```typescript
 * // Advanced: Direct validator usage (bare metal)
 * import { valibotValidator } from "@ws-kit/valibot";
 * import { WebSocketRouter } from "@ws-kit/core";
 *
 * const router = new WebSocketRouter({
 *   validator: valibotValidator(),
 * });
 * // Note: handler payloads are not type-safe without the factory wrapper
 * ```
 */
export default function valibotValidator(): ValidatorAdapter {
  return new ValibotValidatorAdapter();
}
