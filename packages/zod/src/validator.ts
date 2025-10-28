// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { ZodValidatorAdapter } from "./adapter";
import type { ValidatorAdapter } from "@ws-kit/core";

/**
 * Creates a Zod validator adapter for the WebSocket router.
 *
 * This is the recommended way to set up Zod validation. It uses the default
 * Zod instance imported by this package, making it suitable for most applications.
 *
 * @returns A ValidatorAdapter configured with Zod
 *
 * @example
 * ```typescript
 * import { zodValidator, createMessageSchema } from "@ws-kit/zod";
 * import { WebSocketRouter } from "@ws-kit/core";
 * import { z } from "zod";
 *
 * const router = new WebSocketRouter({
 *   validator: zodValidator(),
 * });
 *
 * const { messageSchema } = createMessageSchema(z);
 * const PingSchema = messageSchema("PING", { text: z.string() });
 *
 * router.onMessage(PingSchema, (ctx) => {
 *   console.log(ctx.payload.text);
 * });
 * ```
 */
export default function zodValidator(): ValidatorAdapter {
  return new ZodValidatorAdapter();
}
