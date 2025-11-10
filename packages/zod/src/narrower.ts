// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-safe router narrower for Zod validator family.
 *
 * Advanced use case: When passing routers through generic parameters (e.g., helpers),
 * use this to explicitly assert the router uses Zod validation. Enables stronger
 * type checking in applications requiring validator family consistency.
 *
 * **Note**: Not required for most applications. Use when you need to enforce
 * that a router uses Zod (vs Valibot or other validators).
 *
 * @example
 * ```typescript
 * import { asZodRouter } from "@ws-kit/zod";
 *
 * // Helper function that requires Zod validation
 * export function setupChat(router: IWebSocketRouter<AppData>) {
 *   const zodRouter = asZodRouter(router);
 *   zodRouter.on(JoinRoom, (c) => {
 *     // Handler is properly typed
 *   });
 * }
 * ```
 */

import type { IWebSocketRouter, WebSocketData } from "@ws-kit/core";
import type { TypedZodRouter } from "./router.js";

/**
 * Assert that a router uses Zod validation (type-safe narrower).
 *
 * Provides type-level narrowing to TypedZodRouter with optional runtime validation.
 *
 * Use this when:
 * - Passing routers through generic helper functions
 * - Enforcing Zod validator family consistency
 * - Requiring explicit type checking for multi-validator applications
 *
 * @param router - Any WebSocket router (created with any validator)
 * @param options - Optional runtime validation
 * @returns Router narrowed to TypedZodRouter type, combining TypedZodRouter + IWebSocketRouter
 * @throws TypeError if `validate: true` and router doesn't use Zod validator
 *
 * @example
 * ```typescript
 * // Type-safe narrowing (no runtime cost)
 * const zodRouter = asZodRouter(router);
 * // zodRouter is now TypedZodRouter<TData> & IWebSocketRouter<TData>
 * // All handlers get proper Zod-driven type inference
 *
 * // With runtime validation (for safety in multi-validator applications)
 * const zodRouter = asZodRouter(router, { validate: true });
 * // Throws if router uses Valibot instead of Zod
 * ```
 */
export function asZodRouter<TData extends WebSocketData = WebSocketData>(
  router: IWebSocketRouter<TData>,
  options?: { validate?: boolean },
): TypedZodRouter<TData> & IWebSocketRouter<TData> {
  // Runtime validation (optional, disabled by default for zero overhead)
  if (options?.validate) {
    // Safely check if this is a Zod router without assuming internal structure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (router as any)[Symbol.for("ws-kit.core")] ?? router;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validator = (core as any)?.validator;

    // Check validator by name to work across module boundaries
    const validatorName = validator?.constructor?.name ?? "";
    if (!validatorName.includes("ZodValidatorAdapter")) {
      throw new TypeError(
        `asZodRouter: router does not use Zod validator. ` +
          `Validator is "${validatorName}". ` +
          `Ensure the router was created with createRouter() from @ws-kit/zod.`,
      );
    }
  }

  // Type assertion: narrow to TypedZodRouter
  // Safe because createRouter() from @ws-kit/zod returns TypedZodRouter & IWebSocketRouter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return router as TypedZodRouter<TData> & IWebSocketRouter<TData>;
}
