// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/zod - Zod validator adapter for WS-Kit
 *
 * Canonical import source for Zod-based WebSocket routing.
 *
 * @example
 * ```typescript
 * import { z, message, rpc, withZod, createRouter } from "@ws-kit/zod";
 *
 * const Join = message("JOIN", { roomId: z.string() });
 * const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
 *   id: z.string(),
 *   name: z.string(),
 * });
 *
 * const router = createRouter<{ userId?: string }>()
 *   .plugin(withZod())
 *   .on(Join, (ctx) => {
 *     // ctx.payload: { roomId: string } (inferred + validated)
 *   })
 *   .rpc(GetUser, async (ctx) => {
 *     // ctx.reply({ id: "u1", name: "Alice" });
 *   });
 * ```
 */

// Canonical Zod instance (single import source)
export { z } from "zod";

// Message and RPC schema builders
export { message, rpc } from "./runtime.js";

// Validation plugin (capability gating)
export { withZod } from "./withZod.js";
export type { WithZodOptions } from "./withZod.js";

// Type inference utilities (type-level only)
export type { InferPayload, InferResponse, InferType } from "./types.js";

// Core re-exports (for convenience)
export { createRouter } from "@ws-kit/core";
export type { Router } from "@ws-kit/core";
