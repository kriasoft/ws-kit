// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Request/response correlation tracking.
 * See @client.md#request-response-timeout-semantics and @implementation-status.md#GAP-006.
 */

import {
  ConnectionClosedError,
  ServerError,
  StateError,
  TimeoutError,
  ValidationError,
} from "./errors.js";
import type { AnyMessageSchema } from "./types.js";

interface PendingRequest {
  expectedType: string;
  schema: AnyMessageSchema;
  resolve: (msg: unknown) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  abortHandler: (() => void) | null;
}

export class RequestTracker {
  private pending = new Map<string, PendingRequest>();

  constructor(private limit: number) {}

  /**
   * Registers a pending request.
   * Throws StateError if limit exceeded.
   */
  register(
    correlationId: string,
    expectedType: string,
    schema: AnyMessageSchema,
    timeoutMs: number,
    onFlush: () => void,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // Check if already aborted before dispatch
    if (signal?.aborted) {
      return Promise.reject(new StateError("Request aborted before dispatch"));
    }

    // Check limit before adding
    if (this.pending.size >= this.limit) {
      throw new Error(
        `Pending request limit exceeded (max: ${this.limit}). Consider adding application-level throttling.`,
      );
    }

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        expectedType,
        schema,
        resolve,
        reject,
        timeoutHandle: null, // Set after flush
        abortHandler: null,
      };

      this.pending.set(correlationId, pending);

      // Set up AbortSignal listener
      if (signal) {
        const abortHandler = () => {
          const req = this.pending.get(correlationId);
          if (req) {
            this.pending.delete(correlationId);
            if (req.timeoutHandle) {
              clearTimeout(req.timeoutHandle);
            }
            reject(new StateError("Request aborted"));
          }
        };
        signal.addEventListener("abort", abortHandler);
        pending.abortHandler = abortHandler;
      }

      // Start timeout AFTER message is flushed on OPEN socket
      onFlush();

      // Now start timeout
      pending.timeoutHandle = setTimeout(() => {
        const req = this.pending.get(correlationId);
        if (req) {
          this.pending.delete(correlationId);
          if (req.abortHandler && signal) {
            signal.removeEventListener("abort", req.abortHandler);
          }
        }
        reject(new TimeoutError(timeoutMs));
      }, timeoutMs);
    });
  }

  /**
   * Handles inbound message with correlationId.
   * Four-way dispatch per @implementation-status.md#GAP-006:
   * 1. Type matches → resolve with validated message
   * 2. Type is ERROR → reject with ServerError
   * 3. Type mismatches (non-error) → reject with ValidationError
   * 4. Validation fails → reject with ValidationError
   */
  handleReply(
    msg: unknown,
    safeParse: (
      schema: AnyMessageSchema,
      data: unknown,
    ) => { success: boolean; data?: unknown; error?: unknown },
  ): void {
    // Type guard to ensure msg is an object with meta
    if (
      !msg ||
      typeof msg !== "object" ||
      !("meta" in msg) ||
      !msg.meta ||
      typeof msg.meta !== "object" ||
      !("correlationId" in msg.meta)
    ) {
      return; // Not a correlated message
    }

    const correlationId = (msg.meta as { correlationId: unknown })
      .correlationId;
    if (typeof correlationId !== "string") {
      return; // Not a valid correlationId
    }

    const pending = this.pending.get(correlationId);
    if (!pending) {
      // Already settled or unknown correlationId - drop silently
      return;
    }

    // Type guard to ensure msg has type field
    if (!("type" in msg) || typeof msg.type !== "string") {
      return;
    }

    // Remove from map (first reply settles, subsequent dropped)
    this.pending.delete(correlationId);

    // Cancel timeout
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    // Remove abort listener
    if (pending.abortHandler) {
      // Note: We don't have direct access to signal here, but the handler will be GC'd
      // This is safe because we're settling the promise
      pending.abortHandler = null;
    }

    // 2. Type is ERROR → reject with ServerError
    if (msg.type === "ERROR") {
      const payload =
        "payload" in msg && msg.payload && typeof msg.payload === "object"
          ? (msg.payload as {
              message?: unknown;
              code?: unknown;
              context?: unknown;
            })
          : undefined;

      pending.reject(
        new ServerError(
          typeof payload?.message === "string"
            ? payload.message
            : "Server error",
          typeof payload?.code === "string" ? payload.code : "UNKNOWN",
          payload?.context as Record<string, unknown> | undefined,
        ),
      );
      return;
    }

    // 3. Type mismatches → reject with ValidationError
    if (msg.type !== pending.expectedType) {
      pending.reject(
        new ValidationError(
          `Expected type ${pending.expectedType}, got ${msg.type}`,
          [],
        ),
      );
      return;
    }

    // 4. Validate against schema
    const result = safeParse(pending.schema, msg);
    if (!result.success) {
      const error =
        result.error &&
        typeof result.error === "object" &&
        "issues" in result.error
          ? (result.error as {
              issues?: { path: string[]; message: string }[];
            })
          : undefined;

      pending.reject(
        new ValidationError("Reply validation failed", error?.issues ?? []),
      );
      return;
    }

    // 1. Type matches and valid → resolve
    pending.resolve(result.data);
  }

  /**
   * Rejects all pending requests (on disconnect).
   */
  rejectAll(): void {
    for (const [, pending] of Array.from(this.pending)) {
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      // Note: AbortSignal listeners will be GC'd, no need to remove
      pending.reject(new ConnectionClosedError());
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
