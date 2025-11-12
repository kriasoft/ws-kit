/**
 * Act helpers: convenient wrappers for common test patterns.
 * Optional utilities to reduce test boilerplate.
 *
 * Note: These are just thin wrappers around TestConnection.send().
 * No magic here—validation and dispatch happen normally.
 */

import type { TestConnection } from "./types";
import type { MessageDescriptor } from "../protocol/message-descriptor";

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
  emit<TContext = unknown>(
    conn: TestConnection<TContext>,
    schema: MessageDescriptor & { kind?: "event" },
    payload?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    if (schema.kind && schema.kind !== "event") {
      throw new Error(`Expected event schema, got kind: ${schema.kind}`);
    }
    conn.send(schema.type, payload, meta);
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
  call<TContext = unknown, TResponse = unknown>(
    conn: TestConnection<TContext>,
    schema: MessageDescriptor & { kind?: "rpc"; response?: MessageDescriptor },
    payload?: unknown,
    meta?: Record<string, unknown>,
  ): {
    progress: AsyncIterable<TResponse>;
    result: Promise<TResponse>;
  } {
    if (schema.kind && schema.kind !== "rpc") {
      throw new Error(`Expected RPC schema, got kind: ${schema.kind}`);
    }

    if (!schema.response) {
      throw new Error(`Expected RPC schema with response, got: ${schema.type}`);
    }

    // Generate a correlation ID for this RPC call
    const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Send the request
    const requestMeta = { ...meta, _rpcId: rpcId };
    conn.send(schema.type, payload, requestMeta);

    // Create result/progress iterables
    let resultPromiseResolve: (value: TResponse) => void;
    let resultPromiseReject: (reason?: unknown) => void;
    const resultPromise = new Promise<TResponse>((resolve, reject) => {
      resultPromiseResolve = resolve;
      resultPromiseReject = reject;
    });

    const progressFrames: TResponse[] = [];
    let progressResolved = false;

    // Poll for responses (schema.response is guaranteed to exist from checks above)
    const responseType = (schema.response as MessageDescriptor).type;

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
          yield progressFrames[lastIndex]!;
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
