// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Act helpers: convenient wrappers for common test patterns.
 * Optional utilities to reduce test boilerplate.
 *
 * Note: These are just thin wrappers around TestConnection.send().
 * No magic here—validation and dispatch happen normally.
 */

import type { ConnectionData } from "../context/base-context";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { getKind } from "../schema/metadata";
import type { TestConnection } from "./types";

/**
 * Act helpers for cleaner test code.
 *
 * Example:
 * ```ts
 * const conn = tr.connect();
 * await act.emit(conn, Join, { roomId: "42" });
 * expect(conn.outgoing()).toContainEqual(...);
 * ```
 */
export const act = {
  /**
   * Emit an event message (kind === "event").
   * Throws if schema kind is not "event".
   */
  emit<TContext extends ConnectionData = ConnectionData>(
    conn: TestConnection<TContext>,
    schema: MessageDescriptor,
    payload?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    const kind = getKind(schema);
    if (kind && kind !== "event") {
      throw new Error(`Expected event schema, got kind: ${kind}`);
    }
    conn.send(schema.messageType, payload, meta);
  },

  /**
   * Call an RPC method (kind === "rpc").
   * Throws if schema kind is not "rpc".
   *
   * Returns:
   * - result: Promise that resolves with the terminal RPC response
   * - progress: AsyncIterable of progress updates
   *
   * Example:
   * ```ts
   * const { result, progress } = act.call(conn, GetUser, { id: "u1" });
   *
   * for await (const chunk of progress) {
   *   console.log("Progress:", chunk);
   * }
   *
   * const user = await result;
   * console.log("User:", user);
   * ```
   */
  call<TContext extends ConnectionData = ConnectionData, TResponse = unknown>(
    conn: TestConnection<TContext>,
    schema: MessageDescriptor & { response?: MessageDescriptor },
    payload?: unknown,
    meta?: Record<string, unknown>,
  ): {
    progress: AsyncIterable<TResponse>;
    result: Promise<TResponse>;
  } {
    const kind = getKind(schema);
    if (kind && kind !== "rpc") {
      throw new Error(`Expected RPC schema, got kind: ${kind}`);
    }

    if (!schema.response) {
      throw new Error(
        `RPC schema "${schema.messageType}" must have a response descriptor`,
      );
    }

    // Generate a correlation ID for this RPC call
    const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Send the request
    const requestMeta = { ...meta, correlationId: rpcId };
    conn.send(schema.messageType, payload, requestMeta);

    // Create result/progress iterables
    let resultPromiseResolve: (value: TResponse) => void;
    let resultPromiseReject: (reason: any) => void;
    const resultPromise = new Promise<TResponse>((resolve, reject) => {
      resultPromiseResolve = resolve;
      resultPromiseReject = reject;
    });

    const progressFrames: TResponse[] = [];
    let progressResolved = false;

    // Poll for responses (schema.response is guaranteed to exist from checks above)
    const responseType = (schema.response as MessageDescriptor).messageType;

    const checkForResponses = async (): Promise<void> => {
      const outgoing = conn.outgoing();

      for (const frame of outgoing) {
        const correlationId =
          (frame as any)._rpcId || frame.meta?.correlationId;

        // Check for progress control messages
        if (frame.type === "$ws:rpc-progress" && correlationId === rpcId) {
          progressFrames.push(frame.payload as TResponse);
        }
        // Check for terminal response
        else if (frame.type === responseType && correlationId === rpcId) {
          resultPromiseResolve(frame.payload as TResponse);
          progressResolved = true;
          return;
        }
      }

      // If no terminal response yet, wait a bit and try again
      if (!progressResolved) {
        await new Promise((resolve) => setImmediate(resolve));
        await checkForResponses();
      }
    };

    // Start checking for responses
    checkForResponses().catch((err) => {
      resultPromiseReject(err);
    });

    // Create async iterable for progress
    const progressIterable = (async function* () {
      let lastIndex = 0;

      while (!progressResolved) {
        await new Promise((resolve) => setImmediate(resolve));

        // Yield any new progress frames
        while (lastIndex < progressFrames.length) {
          const frame = progressFrames[lastIndex];
          if (frame !== undefined) {
            yield frame;
          }
          lastIndex++;
        }
      }
    })();

    return {
      progress: progressIterable,
      result: resultPromise,
    };
  },
};
