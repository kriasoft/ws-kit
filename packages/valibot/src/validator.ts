// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { ValibotValidatorAdapter } from "./adapter";
import type { ValidatorAdapter } from "@ws-kit/core";

/**
 * Creates a Valibot validator adapter for the WebSocket router.
 *
 * This is the recommended way to set up Valibot validation. It uses the default
 * Valibot instance imported by this package, making it suitable for most applications.
 *
 * @returns A ValidatorAdapter configured with Valibot
 *
 * @example
 * ```typescript
 * import { valibotValidator, createMessageSchema } from "@ws-kit/valibot";
 * import { WebSocketRouter } from "@ws-kit/core";
 * import * as v from "valibot";
 *
 * const router = new WebSocketRouter({
 *   validator: valibotValidator(),
 * });
 *
 * const { messageSchema } = createMessageSchema(v);
 * const PingSchema = messageSchema("PING", { text: v.string() });
 *
 * router.onMessage(PingSchema, (ctx) => {
 *   console.log(ctx.payload.text);
 * });
 * ```
 */
export default function valibotValidator(): ValidatorAdapter {
  return new ValibotValidatorAdapter();
}
