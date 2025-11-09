import type { PubSub } from "@ws-kit/core";
import type {
  RedisClient,
  RedisPubSubOptions,
  MessageHandler,
  EventHandler,
  Subscription,
  PubSubStatus,
  Events,
  OnceOpts,
  PonceOpts,
  RetryPolicy,
  PublishResult,
} from "./types.js";
import {
  PubSubError,
  PublishError,
  SubscribeError,
  SerializationError,
  DeserializationError,
  DisconnectedError,
  ConfigurationError,
  MaxSubscriptionsExceededError,
} from "./errors.js";

/**
 * RedisPubSub implementation using Redis pub/sub
 *
 * Enables broadcasting across multiple server instances (Bun cluster, Node.js cluster, etc).
 * Each instance connects to the same Redis server and subscribes to relevant channels.
 * Messages are published to Redis and delivered to all subscribers.
 *
 * ## Core Invariants (Non-Negotiable)
 *
 * **At-least-once delivery across reconnects**: Messages may be redelivered. This is intentional—
 * the alternative (exactly-once) requires distributed transactions. Test handlers for idempotency,
 * not against this property.
 *
 * **Per-channel FIFO only, not across channels**: Messages on "ch1" arrive in order; so do messages
 * on "ch2". But if one instance publishes to "ch1" then "ch2", a subscriber might see them in any
 * order. This is unavoidable in distributed pub/sub and acceptable for WS-Kit's use case.
 *
 * **Fail-fast publish (no buffering)**: If `publish()` is called while disconnected, it rejects
 * immediately. No queue. This eliminates "silent" message loss (caller must handle rejection),
 * prevents unbounded memory growth, and keeps semantics predictable. If you need buffering,
 * implement it at the application layer. Use `publishWithRetry()` for automatic resilience.
 *
 * **Two Redis connections required**: `publish()` and `subscribe()/psubscribe()` require separate
 * connections per Redis protocol. If you pass a client, it must support `duplicate()`.
 *
 * **Automatic re-subscription on reconnect**: `desiredChannels`/`desiredPatterns` persist across reconnects
 * and are automatically re-established. `confirmedChannels`/`confirmedPatterns` are cleared IMMEDIATELY
 * on error (not on 'end' event). This ensures `ensureSubscribed()` fails fast if queried during reconnect,
 * and prevents stale subscription state from hiding connection issues.
 *
 * ## Semantics
 *
 * - **Delivery**: At-least-once (messages may be redelivered on reconnect)
 * - **Ordering**: Per-channel FIFO; unordered across channels and after reconnects
 * - **Publish while disconnected**: Fails immediately with retryable error (no buffering, no queue)
 * - **Subscribe while disconnected**: Returns immediately with a ready promise; auto-subscribes on connect
 * - **Serialization**: Strict JSON/text/binary contract; no auto-detection or guessing
 * - **Lifecycle ownership**: If you pass `client`, you own it; RedisPubSub won't close it
 * - **Namespace guard**: Throws TypeError on pre-colon-prefixed channels to prevent bugs
 *
 * ## Features
 *
 * - Automatic connection establishment (lazy, on first use)
 * - Automatic reconnection with exponential backoff + full jitter (thundering herd protection)
 * - Automatic re-subscription after reconnect (subscriptions persist across disconnects)
 * - Channel namespace support for multi-tenancy with safe `ns()` scoping
 * - Strict message serialization with JSON/text/binary defaults
 * - Strongly typed event listeners for lifecycle hooks (IDE autocomplete)
 * - Pattern subscriptions (Redis PSUBSCRIBE) via `psubscribe()` method
 * - Built-in `publishWithRetry()` helper with configurable policy
 */
export class RedisPubSub implements PubSub {
  // TWO CONNECTIONS REQUIRED (Redis protocol constraint):
  // - publishClient: For publish() operations
  // - subscribeClient: For subscribe()/psubscribe() operations
  // Redis protocol forbids publish/subscribe on the same connection. This is non-negotiable.
  // If user provides a client, it must support duplicate() to create a second connection.
  private publishClient: RedisClient | null = null;
  private subscribeClient: RedisClient | null = null;
  private subscriptions = new Map<string, Set<MessageHandler>>();
  private patternSubscriptions = new Map<string, Set<MessageHandler>>();

  // Channel state tracking
  // INVARIANT: desiredChannels/desiredPatterns persist across reconnects; confirmedChannels/confirmedPatterns are cleared on disconnect.
  // NOTE: confirmedChannels/confirmedPatterns are cleared IMMEDIATELY on error (before end event), so ensureSubscribed() fails fast.
  // IMPORTANT ASYMMETRY: Subscriptions auto-restore on reconnect (subscribe has no buffering but does auto-restore),
  // while publish is fail-fast with no buffering. This is intentional: subscriptions are stateful, publish is transactional.
  private desiredChannels = new Set<string>(); // Channels we want subscribed (persists across reconnects)
  private desiredPatterns = new Set<string>(); // Patterns we want subscribed
  private confirmedChannels = new Set<string>(); // Channels Redis confirmed (cleared on disconnect)
  private confirmedPatterns = new Set<string>(); // Patterns Redis confirmed
  private pendingSubs = new Map<string, Promise<void>>(); // Ongoing subscription attempts
  private pendingPatterns = new Map<string, Promise<void>>();

  private connected = false;
  private destroyed = false;
  private reconnectAttempts = 0;
  private reconnectDelay = 100;
  private maxReconnectDelay: number;
  private maxReconnectAttempts: number | "infinite";
  private namespace: string;
  // userOwnedClient: if true, user owns client lifecycle; destroy() never calls quit()
  private userOwnedClient = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  // inflightPublishes: counts concurrent publish() calls (not buffered; for status monitoring)
  private inflightPublishes = 0;
  // lastError: most recent error (never auto-cleared; helps debugging)
  private lastError: Error | undefined;

  // Event emitter: use Map<string, Set> for efficient listener lookup.
  // Sets stay in map even when empty (cheaper than deleting+recreating on add/remove cycles).
  // Union type ensures only valid event names can be emitted (enforced by emit() signature).
  private eventListeners = new Map<
    "connect" | "disconnect" | "reconnecting" | "reconnected" | "error",
    Set<EventHandler>
  >();

  // Serialization
  // NOTE: Custom serializer (if provided as object) completely replaces the default pipeline.
  // There is NO fallback, NO composition. Users who need multiple formats must multiplex in encode/decode.
  private serializer:
    | "json"
    | "text"
    | "binary"
    | {
        encode: (x: unknown) => string;
        decode: (s: string) => unknown;
      };

  public readonly options: RedisPubSubOptions;

  constructor(options: RedisPubSubOptions = {}) {
    validateOptions(options);
    this.options = options;
    // Normalize namespace: accept "app:", " app : ", etc. → "app"
    this.namespace = normalizeNamespace(options.namespace);
    this.maxReconnectDelay = options.retry?.maxMs ?? 30000;
    this.maxReconnectAttempts = options.retry?.maxAttempts ?? "infinite";
    this.userOwnedClient = !!options.client;
    this.serializer = options.serializer ?? "json";
  }

  /**
   * Publish a message to a channel.
   * **Fails immediately if disconnected (no buffering, no queue, no waiting).**
   *
   * Core Invariant: `publish()` is transactional. It either succeeds (message reached Redis)
   * or throws immediately with a retryable/non-retryable error. No timeout, no queue.
   *
   * **Serialization Contract**: Uses the instance-wide serializer configured at creation time.
   * All messages on all channels use the same serialization format. This ensures predictable,
   * observable encoding and guards against format mismatches that silent per-message overrides would create.
   *
   * Design Rationale: Fail-fast prevents silent message loss and unbounded memory growth.
   * If you need resilience to transient failures, use `publishWithRetry()` instead.
   * Application-layer buffering gives you control over retry policy and observability.
   *
   * @param channel The channel name
   * @param message The message payload
   * @param options Optional publish options (reserved for future extensions; currently unused)
   *
   * @throws {DisconnectedError} if not connected (retryable: true if not destroyed)
   * @throws {PublishError} if publish fails (retryable based on cause)
   * @throws {SerializationError} if message serialization fails (not retryable)
   *
   * @example
   * // Publish now or fail immediately
   * try {
   *   await pubsub.publish("chat:general", { user: "alice", text: "hi" });
   * } catch (err) {
   *   if (err instanceof PublishError && err.retryable) {
   *     // Transient error: network, disconnected, etc. Consider retry or publishWithRetry().
   *   } else {
   *     // Permanent error: serialization failed, instance destroyed, etc. Don't retry.
   *   }
   * }
   */
  async publish<T = unknown>(
    channel: string,
    message: T,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: unknown, // Reserved for future extensions
  ): Promise<void> {
    if (this.destroyed) {
      throw new DisconnectedError(
        "Cannot publish: instance has been destroyed",
        { retryable: false },
      );
    }

    const prefixed = this.prefixChannel(channel);
    // Track in-flight publishes for status monitoring (observability, not buffering)
    this.inflightPublishes++;

    try {
      if (!this.publishClient?.isOpen) {
        await this.ensurePublishClient();
      }

      const serialized = this.serialize(message);
      if (this.publishClient?.isOpen) {
        await this.publishClient.publish?.(prefixed, serialized);
      }
    } catch (error) {
      // Reset client on error to force reconnect on next publish
      this.publishClient = null;
      // Store for status().lastError (helps debugging via monitoring)
      this.lastError =
        error instanceof Error ? error : new Error(String(error));

      if (error instanceof PubSubError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      throw new PublishError(
        `Failed to publish to channel "${channel}": ${err.message}`,
        {
          cause: err,
          channel,
          retryable: this.isRetryable(err),
        },
      );
    } finally {
      // Always decrement, even if error; ensures counter stays accurate
      this.inflightPublishes--;
    }
  }

  /**
   * Subscribe to an exact channel with a handler function.
   * Returns a Subscription object with { channel, ready, unsubscribe() }.
   *
   * **Subscription Semantics**:
   * - Handler is called immediately upon subscription (registration is immediate).
   * - `ready` promise resolves after Redis confirms the subscription (ACK).
   * - After reconnect, Redis re-subscribes automatically; handler registration persists.
   * - `unsubscribe()` removes the handler (idempotent; may still receive in-flight messages).
   *
   * **At-least-once delivery**: Handlers must be idempotent. Reconnects may replay messages.
   * **Per-channel FIFO**: Order guaranteed per channel only. Across channels or after reconnect: undefined.
   *
   * **Handler signature**: `(message: T, meta: { channel: string }) => void`
   * The meta object includes the actual channel name.
   *
   * For pattern-based subscriptions, use `psubscribe()` instead.
   *
   * @param channel The exact channel name to subscribe to
   * @param handler Called with each message and channel metadata (must be idempotent)
   * @returns Subscription object with channel, ready promise, and unsubscribe method
   *
   * @throws {MaxSubscriptionsExceededError} if subscription count would exceed limit
   * @throws {DisconnectedError} if instance is destroyed
   *
   * @example
   * ```typescript
   * const sub = pubsub.subscribe("room:42", (msg, meta) => {
   *   console.log(`Message on ${meta.channel}:`, msg);
   * });
   * await sub.ready; // Wait for Redis ACK
   * sub.unsubscribe(); // Stop listening
   * ```
   */
  subscribe<T = unknown>(
    channel: string,
    handler: (message: T, meta: { channel: string }) => void,
  ): Subscription {
    if (this.destroyed) {
      throw new DisconnectedError(
        "Cannot subscribe: instance has been destroyed",
        { retryable: false },
      );
    }

    const prefixed = this.prefixChannel(channel);

    // Check subscription limit
    const currentCount =
      this.subscriptions.size + this.patternSubscriptions.size;
    if (
      this.options.maxSubscriptions &&
      currentCount >= this.options.maxSubscriptions
    ) {
      throw new MaxSubscriptionsExceededError(
        `Maximum subscriptions (${this.options.maxSubscriptions}) exceeded`,
        this.options.maxSubscriptions,
      );
    }

    // Register handler immediately
    let handlers = this.subscriptions.get(prefixed);
    if (!handlers) {
      handlers = new Set();
      this.subscriptions.set(prefixed, handlers);
    }
    handlers.add(handler as MessageHandler);

    // Add to desired channels
    this.desiredChannels.add(prefixed);

    // Create or reuse ready promise
    let readyPromise: Promise<void>;
    if (!this.confirmedChannels.has(prefixed)) {
      const pending = this.pendingSubs.get(prefixed);
      if (pending) {
        readyPromise = pending;
      } else {
        const subPromise = this.establishSubscription(prefixed).catch(
          (error) => {
            const subError = new SubscribeError(
              `Failed to subscribe to channel "${channel}"`,
              {
                cause: error instanceof Error ? error : undefined,
                channel,
                retryable: this.isRetryable(error),
              },
            );
            this.options.logger?.error?.("Subscribe error:", subError);
            this.emit("error", subError);
          },
        );

        this.pendingSubs.set(prefixed, subPromise);
        readyPromise = subPromise;
      }
    } else {
      // Already confirmed, ready immediately
      readyPromise = Promise.resolve();
    }

    // Return Subscription object
    return {
      channel: channel, // Return the user-provided channel name (not prefixed)
      ready: readyPromise,
      unsubscribe: () => {
        this.unsubscribe(channel, handler as MessageHandler);
      },
    };
  }

  /**
   * Subscribe to a channel pattern (glob syntax: *, ?, [...]) with a handler function.
   * Returns a Subscription object with { channel, ready, unsubscribe() }.
   *
   * **Pattern Semantics**:
   * - Matches all channels that fit the glob pattern (*, ?, [...])
   * - Handler receives messages from any matching channel with actual channel name in meta
   * - Same lifecycle as exact subscriptions (auto-reconnect, idempotent unsubscribe)
   *
   * **Design Intent**: Separate from `subscribe()` to prevent accidental glob subscriptions
   * from strings containing `*` or `?` characters. Explicit method makes intent unmistakable.
   *
   * @param pattern The glob pattern (*, ?, [...]) to subscribe to
   * @param handler Called with each message from matching channels (must be idempotent)
   * @returns Subscription object with pattern, ready promise, and unsubscribe method
   *
   * @throws {MaxSubscriptionsExceededError} if subscription count would exceed limit
   * @throws {DisconnectedError} if instance is destroyed
   *
   * @example
   * ```typescript
   * const sub = pubsub.psubscribe("user:*", (msg, meta) => {
   *   console.log(`Update for ${meta.channel}:`, msg);
   * });
   * await sub.ready; // Wait for Redis ACK
   * sub.unsubscribe(); // Stop listening to all matching channels
   * ```
   */
  psubscribe<T = unknown>(
    pattern: string,
    handler: (message: T, meta: { channel: string }) => void,
  ): Subscription {
    if (this.destroyed) {
      throw new DisconnectedError(
        "Cannot psubscribe: instance has been destroyed",
        { retryable: false },
      );
    }

    return this.subscribeToPattern(pattern, handler as MessageHandler);
  }

  /**
   * Internal helper: Subscribe to a channel pattern (glob syntax: *, ?, [])
   * Returns a Subscription object.
   */
  private subscribeToPattern(
    pattern: string,
    handler: MessageHandler,
  ): Subscription {
    const prefixed = this.prefixChannel(pattern);

    // Check subscription limit
    const currentCount =
      this.subscriptions.size + this.patternSubscriptions.size;
    if (
      this.options.maxSubscriptions &&
      currentCount >= this.options.maxSubscriptions
    ) {
      throw new MaxSubscriptionsExceededError(
        `Maximum subscriptions (${this.options.maxSubscriptions}) exceeded`,
        this.options.maxSubscriptions,
      );
    }

    // Register handler
    let handlers = this.patternSubscriptions.get(prefixed);
    if (!handlers) {
      handlers = new Set();
      this.patternSubscriptions.set(prefixed, handlers);
    }
    handlers.add(handler);

    // Add to desired patterns
    this.desiredPatterns.add(prefixed);

    // Create or reuse ready promise
    let readyPromise: Promise<void>;
    if (!this.confirmedPatterns.has(prefixed)) {
      const pending = this.pendingPatterns.get(prefixed);
      if (pending) {
        readyPromise = pending;
      } else {
        const subPromise = this.establishPatternSubscription(prefixed).catch(
          (error) => {
            const subError = new SubscribeError(
              `Failed to subscribe to pattern "${pattern}"`,
              {
                cause: error instanceof Error ? error : undefined,
                retryable: this.isRetryable(error),
              },
            );
            this.options.logger?.error?.("Pattern subscribe error:", subError);
            this.emit("error", subError);
          },
        );

        this.pendingPatterns.set(prefixed, subPromise);
        readyPromise = subPromise;
      }
    } else {
      // Already confirmed, ready immediately
      readyPromise = Promise.resolve();
    }

    // Return Subscription object
    return {
      channel: pattern, // Return the user-provided pattern (not prefixed)
      ready: readyPromise,
      unsubscribe: () => {
        this.unsubscribeFromPattern(pattern, handler);
      },
    };
  }

  /**
   * Unsubscribe a handler from a channel
   */
  unsubscribe(channel: string, handler: MessageHandler): void {
    const prefixed = this.prefixChannel(channel);
    const handlers = this.subscriptions.get(prefixed);

    if (handlers) {
      handlers.delete(handler);

      // If no more handlers, clean up channel state
      if (handlers.size === 0) {
        this.subscriptions.delete(prefixed);
        this.desiredChannels.delete(prefixed);
        this.confirmedChannels.delete(prefixed);

        if (this.subscribeClient?.isOpen) {
          this.unsubscribeFromChannel(prefixed).catch((error) => {
            this.options.logger?.warn?.(
              `Failed to unsubscribe from channel "${channel}":`,
              error instanceof Error ? error.message : String(error),
            );
          });
        }
      }
    }
  }

  /**
   * Unsubscribe a handler from a pattern
   */
  private unsubscribeFromPattern(
    pattern: string,
    handler: MessageHandler,
  ): void {
    const prefixed = this.prefixChannel(pattern);
    const handlers = this.patternSubscriptions.get(prefixed);

    if (handlers) {
      handlers.delete(handler);

      if (handlers.size === 0) {
        this.patternSubscriptions.delete(prefixed);
        this.desiredPatterns.delete(prefixed);
        this.confirmedPatterns.delete(prefixed);

        if (this.subscribeClient?.isOpen) {
          this.unsubscribeFromPatternRedis(prefixed).catch((error) => {
            this.options.logger?.warn?.(
              `Failed to unsubscribe from pattern "${pattern}":`,
              error instanceof Error ? error.message : String(error),
            );
          });
        }
      }
    }
  }

  /**
   * Unsubscribe from a pattern on the subscribe client
   */
  private async unsubscribeFromPatternRedis(pattern: string): Promise<void> {
    if (this.subscribeClient?.isOpen) {
      await this.subscribeClient.pUnsubscribe?.(pattern);
    }
  }

  /**
   * Wait for a single message on an exact channel and auto-unsubscribe
   *
   * @param channel The exact channel to wait on
   * @param opts Optional options (timeout)
   * @returns The message payload
   *
   * @throws {DisconnectedError} if instance is destroyed
   * @throws {Error} if timeout exceeded
   *
   * @example
   * ```typescript
   * try {
   *   const msg = await pubsub.once("notifications:42", { timeoutMs: 5000 });
   *   console.log("Got notification:", msg);
   * } catch (err) {
   *   console.log("Timeout waiting for notification");
   * }
   * ```
   */
  async once<T = unknown>(channel: string, opts?: OnceOpts): Promise<T> {
    if (this.destroyed) {
      throw new DisconnectedError(
        "Cannot wait for message: instance has been destroyed",
        { retryable: false },
      );
    }

    let resolve: (msg: T) => void;
    let reject: (err: Error) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const handler = (msg: T) => {
      sub.unsubscribe();
      resolve(msg);
    };

    const sub = this.subscribe(channel, handler);

    // Optional timeout
    if (opts?.timeoutMs) {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(
          new Error(
            `Timeout waiting for message on "${channel}" after ${opts.timeoutMs}ms`,
          ),
        );
      }, opts.timeoutMs);

      return promise.finally(() => clearTimeout(timer));
    }

    return promise;
  }

  /**
   * Wait for a single message matching a pattern and auto-unsubscribe
   *
   * Subscribes to the pattern, waits for the first matching message, then unsubscribes.
   * Useful for one-off pattern-matched waits (e.g., "wait for any user:* update").
   *
   * @param pattern The glob pattern to wait on
   * @param opts Optional options (timeout)
   * @returns The message payload
   *
   * @throws {DisconnectedError} if instance is destroyed
   * @throws {Error} if timeout exceeded
   *
   * @example
   * ```typescript
   * try {
   *   const msg = await pubsub.ponce("room:*:messages", { timeoutMs: 10000 });
   *   console.log("Got message from any room:", msg);
   * } catch (err) {
   *   console.log("Timeout waiting for message");
   * }
   * ```
   */
  async ponce<T = unknown>(pattern: string, opts?: PonceOpts): Promise<T> {
    if (this.destroyed) {
      throw new DisconnectedError(
        "Cannot wait for message: instance has been destroyed",
        { retryable: false },
      );
    }

    let resolve: (msg: T) => void;
    let reject: (err: Error) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const handler = (msg: T) => {
      sub.unsubscribe();
      resolve(msg);
    };

    const sub = this.psubscribe(pattern, handler);

    // Optional timeout
    if (opts?.timeoutMs) {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(
          new Error(
            `Timeout waiting for message on pattern "${pattern}" after ${opts.timeoutMs}ms`,
          ),
        );
      }, opts.timeoutMs);

      return promise.finally(() => clearTimeout(timer));
    }

    return promise;
  }

  /**
   * Wait for the instance to be ready (connected at least once).
   * Useful for bootstrapping and health checks.
   * Resolves immediately if already connected.
   */
  async ready(): Promise<void> {
    if (this.connected) {
      return; // Already connected
    }
    // Wait for first successful connection
    return new Promise((resolve) => {
      const unsubConnect = this.on("connect", () => {
        unsubConnect();
        unsubError();
        resolve();
      });
      const unsubError = this.on("error", () => {
        // Don't reject on error; keep waiting for eventual connection
        // (errors are expected during reconnection attempts)
      });
    });
  }

  /**
   * Get the current status snapshot
   *
   * Split exact/patterns to help dashboards distinguish subscription types.
   * Strips namespace prefix for cleaner output (internal state is prefixed).
   * LastError includes code, message, and timestamp for operational visibility.
   */
  status(): PubSubStatus {
    const stripNamespace = (ch: string) => {
      if (this.namespace && ch.startsWith(this.namespace + ":")) {
        return ch.slice(this.namespace.length + 1);
      }
      return ch;
    };

    const result: PubSubStatus = {
      connected:
        this.connected &&
        (this.publishClient?.isOpen === true ||
          this.subscribeClient?.isOpen === true),
      // Split exact/patterns: they use different Redis commands (SUBSCRIBE vs PSUBSCRIBE) and have different guarantees
      channels: {
        exact: Array.from(this.desiredChannels).map(stripNamespace),
        patterns: Array.from(this.desiredPatterns).map(stripNamespace),
      },
      // In-flight count for dashboards (not buffered; just tracks concurrent publish() calls)
      inflightPublishes: this.inflightPublishes,
    };

    // Most recent error (not cleared; helps debug connection issues)
    // Timestamp is current time (when status was called), not when error occurred
    if (this.lastError) {
      result.lastError = {
        code:
          this.lastError instanceof PubSubError
            ? this.lastError.code
            : "UNKNOWN",
        message: this.lastError.message,
        at: Date.now(),
      };
    }

    return result;
  }

  /**
   * Check if connected to Redis
   */
  isConnected(): boolean {
    return (
      this.connected &&
      (this.publishClient?.isOpen === true ||
        this.subscribeClient?.isOpen === true)
    );
  }

  /**
   * Check if a channel has active subscribers
   */
  isSubscribed(channel: string): boolean {
    const prefixed = this.prefixChannel(channel);
    return this.subscriptions.has(prefixed);
  }

  /**
   * Check if the instance has been destroyed
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Publish a message with automatic retry on failure
   * Respects PublishError.retryable flag and applies bounded exponential backoff + jitter
   *
   * **Important**: This is a convenience helper for the common "retry until success" pattern.
   * It's NOT used internally; `publish()` always fails fast. Use `publishWithRetry()` when you need
   * resilience to transient network errors.
   *
   * **Jitter**: Full jitter (random [0, delay]) is the default to prevent thundering herd.
   * Recommended for distributed systems.
   *
   * **Returns**: On success, returns PublishResult with attempt count and duration in details field.
   * **Throws**: On non-retryable errors or if all retries exhausted.
   *
   * @param channel The channel name
   * @param message The message payload
   * @param policy Optional retry policy (defaults: maxAttempts=3, initialDelayMs=100, maxDelayMs=10_000, jitter="full")
   * @returns PublishResult with capability="unknown", attempts count, and durationMs in details field
   *
   * @throws {PublishError} if all retry attempts fail or non-retryable error encountered
   * @throws {DisconnectedError} if instance is destroyed
   */
  async publishWithRetry<T = unknown>(
    channel: string,
    message: T,
    policy?: RetryPolicy,
  ): Promise<PublishResult> {
    const startTime = Date.now();
    const maxAttempts = policy?.maxAttempts ?? 3;
    const initialDelayMs = policy?.initialDelayMs ?? 100;
    const maxDelayMs = policy?.maxDelayMs ?? 10_000;
    const jitter = policy?.jitter ?? "full";
    const onAttempt = policy?.onAttempt;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.publish(channel, message);
        // Success: return result with attempt count and duration
        const durationMs = Date.now() - startTime;
        return {
          ok: true,
          capability: "unknown", // Redis Pub/Sub cannot report delivery count
          details: {
            attempts: attempt,
            durationMs,
          },
          // Keep diag for backwards compatibility
          diag: {
            attempts: attempt,
            durationMs,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        lastError = err;

        // Don't retry non-retryable errors (serialization, destroyed instance, etc.)
        if (error instanceof PublishError && !error.retryable) {
          throw error;
        }

        // Don't retry if this was the last attempt
        if (attempt === maxAttempts) {
          throw error;
        }

        // Calculate backoff delay with exponential growth
        const baseDelay = Math.min(
          initialDelayMs * Math.pow(2, attempt - 1),
          maxDelayMs,
        );
        const delayMs =
          jitter === "none"
            ? baseDelay
            : jitter === "full"
              ? baseDelay * Math.random() // [0, baseDelay]
              : baseDelay; // decorrelated jitter (reserved for future)

        // Invoke callback if provided (for logging/metrics)
        onAttempt?.(attempt, Math.round(delayMs), err);

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Should not reach here, but just in case
    throw (
      lastError ||
      new PublishError(`Failed to publish after ${maxAttempts} attempts`)
    );
  }

  /**
   * Create a scoped namespace for safe channel prefixing
   * Prevents double-prefix accidents and allows ergonomic channel composition
   *
   * **Design Rationale**: The option-level `namespace` config will throw if you pass a pre-colon-prefixed
   * channel (e.g., subscribe("app:ch") when namespace="app"). This is intentional—idempotent prefixing hides bugs.
   * Use `ns()` instead to avoid that footgun: `pubsub.ns("app").subscribe("ch")` is always safe.
   *
   * **Nested scoping is safe**: `pubsub.ns("a").ns("b")` produces "a:b:" prefix (colon-separated).
   *
   * @param prefix The namespace prefix (e.g., "chat", "notifications")
   * @returns A proxy object with the same interface, all channels automatically prefixed
   *
   * @example
   * const chat = pubsub.ns("chat");
   * const roomSub = chat.subscribe("room:1", handler); // subscribes to "chat:room:1"
   * await chat.publish("room:1", msg); // publishes to "chat:room:1"
   * const rooms = chat.ns("rooms");
   * const generalSub = rooms.subscribe("general", handler); // "chat:rooms:general"
   */
  ns(prefix: string): RedisPubSub {
    // Create a shallow proxy that prefixes all channel names
    return new Proxy(this, {
      get(target: RedisPubSub, prop: PropertyKey): unknown {
        // For channel-related methods, wrap to add prefix
        if (
          prop === "publish" ||
          prop === "subscribe" ||
          prop === "psubscribe" ||
          prop === "once" ||
          prop === "ponce"
        ) {
          return async (
            channel: string,
            ...args: unknown[]
          ): Promise<unknown> => {
            const prefixedChannel = `${prefix}:${channel}`;
            const method = target[prop as keyof RedisPubSub] as (
              ...methodArgs: unknown[]
            ) => unknown;
            return method.apply(target, [prefixedChannel, ...args]);
          };
        }

        // For ns(), create nested scope
        if (prop === "ns") {
          return (nextPrefix: string): RedisPubSub => {
            return target.ns(`${prefix}:${nextPrefix}`);
          };
        }

        // For all other methods/properties, return as-is
        return (target as unknown as Record<PropertyKey, unknown>)[prop];
      },
    }) as unknown as RedisPubSub;
  }

  /**
   * Establish connection eagerly (optional, normally lazy on first use)
   */
  async connect(): Promise<void> {
    if (this.destroyed) {
      throw new DisconnectedError(
        "Cannot connect: instance has been destroyed",
        { retryable: false },
      );
    }
    await this.ensurePublishClient();
  }

  /**
   * Close all connections and destroy the instance.
   * After calling close(), all operations reject with DisconnectedError (retryable: false)
   * Idempotent: safe to call multiple times.
   */
  async close(): Promise<void> {
    this.destroyed = true;
    this.subscriptions.clear();
    this.patternSubscriptions.clear();
    this.desiredChannels.clear();
    this.desiredPatterns.clear();
    this.confirmedChannels.clear();
    this.confirmedPatterns.clear();
    this.pendingSubs.clear();
    this.pendingPatterns.clear();
    this.eventListeners.clear();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const promises: Promise<unknown>[] = [];

    // Only close publish client if we created it (not user-provided)
    if (this.publishClient?.isOpen && !this.userOwnedClient) {
      const quitPromise = this.publishClient.quit?.();
      if (quitPromise) {
        promises.push(
          quitPromise.catch(() => {
            /* ignore */
          }),
        );
      }
    }

    // Only close subscribe client if it's a separate instance we created
    if (
      this.subscribeClient?.isOpen &&
      this.subscribeClient !== this.publishClient
    ) {
      const quitPromise = this.subscribeClient.quit?.();
      if (quitPromise) {
        promises.push(
          quitPromise.catch(() => {
            /* ignore */
          }),
        );
      }
    }

    await Promise.allSettled(promises);
    this.publishClient = null;
    this.subscribeClient = null;
    this.connected = false;
  }

  /**
   * Listen for lifecycle events with strongly typed payloads
   * @returns Function to unsubscribe
   */
  on<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void,
  ): () => void {
    const eventKey = event as
      | "connect"
      | "disconnect"
      | "reconnecting"
      | "reconnected"
      | "error";
    let handlers = this.eventListeners.get(eventKey);
    if (!handlers) {
      handlers = new Set();
      this.eventListeners.set(eventKey, handlers);
    }
    handlers.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Stop listening to an event
   */
  off<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void,
  ): void {
    const eventKey = event as
      | "connect"
      | "disconnect"
      | "reconnecting"
      | "reconnected"
      | "error";
    this.eventListeners.get(eventKey)?.delete(handler as EventHandler);
  }

  // ========== Private Methods ==========

  /**
   * Check if an error is retryable, consulting custom hook if provided
   */
  private isRetryable(error: unknown): boolean {
    // Consult custom hook first
    const hookResult = this.options.isRetryable?.(error);
    if (hookResult !== undefined) {
      return hookResult;
    }
    // Fall back to default network error detection
    return isRetryableNetworkError(error);
  }

  /**
   * Emit an event to all listeners (internal use, bypasses type safety)
   */
  private emit<K extends keyof Events>(event: K, arg?: Events[K]): void {
    const eventKey = event as
      | "connect"
      | "disconnect"
      | "reconnecting"
      | "reconnected"
      | "error";
    const handlers = this.eventListeners.get(eventKey);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(arg);
        } catch (err) {
          this.options.logger?.error?.(
            `Error in ${event} event handler:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  /**
   * Ensure publish client is connected
   */
  private async ensurePublishClient(): Promise<RedisClient> {
    if (this.publishClient?.isOpen) {
      return this.publishClient;
    }

    try {
      this.publishClient = await this.createPublishClient();
      this.setupPublishClientHandlers();
      this.reconnectAttempts = 0;
      this.reconnectDelay = this.options.retry?.initialMs ?? 100;
      this.connected = true;
      this.options.logger?.info?.("Connected to Redis (publish)");
      this.emit("connect");
      return this.publishClient;
    } catch (error) {
      await this.handleConnectionError(error);
      throw new PublishError(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          retryable: true,
        },
      );
    }
  }

  /**
   * Ensure subscribe client is connected
   */
  private async ensureSubscribeClient(): Promise<RedisClient> {
    if (this.subscribeClient?.isOpen) {
      return this.subscribeClient;
    }

    try {
      this.subscribeClient = await this.createSubscribeClient();
      this.setupSubscriptionHandlers();
      this.reconnectAttempts = 0;
      this.reconnectDelay = this.options.retry?.initialMs ?? 100;
      this.connected = true;
      this.options.logger?.info?.("Connected to Redis (subscribe)");
      this.emit("connect");

      // Re-subscribe to all desired channels
      for (const channel of this.desiredChannels) {
        if (
          !this.confirmedChannels.has(channel) &&
          !this.pendingSubs.has(channel)
        ) {
          this.establishSubscription(channel).catch((error) => {
            const subError = new SubscribeError(
              `Failed to subscribe to channel`,
              {
                cause: error instanceof Error ? error : undefined,
                retryable: this.isRetryable(error),
              },
            );
            this.options.logger?.error?.("Subscribe error:", subError);
            this.emit("error", subError);
          });
        }
      }

      // Re-subscribe to all desired patterns
      for (const pattern of this.desiredPatterns) {
        if (
          !this.confirmedPatterns.has(pattern) &&
          !this.pendingPatterns.has(pattern)
        ) {
          this.establishPatternSubscription(pattern).catch((error) => {
            const subError = new SubscribeError(
              `Failed to subscribe to pattern`,
              {
                cause: error instanceof Error ? error : undefined,
                retryable: this.isRetryable(error),
              },
            );
            this.options.logger?.error?.("Pattern subscribe error:", subError);
            this.emit("error", subError);
          });
        }
      }

      return this.subscribeClient;
    } catch (error) {
      await this.handleConnectionError(error);
      throw new SubscribeError(
        `Failed to connect subscribe client: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          retryable: true,
        },
      );
    }
  }

  /**
   * Create a new Redis client for publishing
   */
  private async createPublishClient(): Promise<RedisClient> {
    // Use pre-configured client if provided
    if (this.options.client) {
      if (!this.options.client.isOpen) {
        await this.options.client.connect?.();
      }
      return this.options.client;
    }

    return this.createClientFromUrl();
  }

  /**
   * Create a new Redis client for subscribing
   *
   * INVARIANT: Two connections always required—Redis protocol forbids publish/subscribe on same connection.
   * Enforces duplicate() support to prevent silent fallback to single connection (would break sub-during-pub).
   */
  private async createSubscribeClient(): Promise<RedisClient> {
    if (this.options.client) {
      const base = this.options.client;
      if (!base.isOpen) {
        await base.connect?.();
      }

      // CRITICAL: Must have duplicate() (redis v4+). Fail fast rather than silently degrade.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (base as any).duplicate !== "function") {
        throw new ConfigurationError(
          "Redis client must support duplicate() method for creating separate subscription connection. " +
            "Please upgrade to redis v4+ or provide a compatible client.",
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const duplicated = (base as any).duplicate() as RedisClient;
      if (!duplicated.isOpen) {
        await duplicated.connect?.();
      }
      return duplicated;
    }

    return this.createClientFromUrl();
  }

  /**
   * Create a new Redis client from URL
   */
  private async createClientFromUrl(): Promise<RedisClient> {
    // Dynamically import redis module (peer dependency)
    let createClient;
    try {
      const redisModule = await import("redis");
      createClient = redisModule.createClient;
    } catch {
      throw new Error(
        "redis module not found. Install it with: npm install redis",
      );
    }

    // Build connection options from URL
    const clientOptions: Record<string, unknown> = {};

    if (this.options.url) {
      clientOptions.url = this.options.url;
    } else {
      // Default to localhost
      clientOptions.url = "redis://localhost:6379";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createClient(clientOptions) as any as RedisClient;
    await client.connect?.();
    return client;
  }

  /**
   * Setup error and lifecycle handlers for publish client
   */
  private setupPublishClientHandlers(): void {
    if (!this.publishClient) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.publishClient as any;

    client.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.connected = false;
      this.lastError = err;
      this.options.logger?.error?.("Publish client error:", err);
      const pubError = new PublishError(`Connection error: ${err.message}`, {
        cause: err,
        retryable: true,
      });
      this.emit("error", pubError);
      this.handleConnectionError(err);
    });

    client.on("end", () => {
      this.connected = false;
      this.publishClient = null;
      this.options.logger?.warn?.("Publish client disconnected");
      this.emit("disconnect", { willReconnect: !this.destroyed });
      this.attemptReconnect();
    });
  }

  /**
   * Setup error and lifecycle handlers for subscribe client
   *
   * **CRITICAL INVARIANT**: confirmedChannels/confirmedPatterns are cleared IMMEDIATELY on error event,
   * BEFORE the 'end' event fires. This prevents stale state from hiding connection issues.
   *
   * Why this timing:
   * - desiredChannels/desiredPatterns persist across reconnects (auto-restore subscriptions)
   * - confirmedChannels/confirmedPatterns represent "what Redis actually knows about"
   * - If we wait for 'end' event, a queried isSubscribed(ch) might return true during reconnect (wrong)
   * - By clearing on error, isSubscribed(ch) immediately returns false during reconnect (correct)
   * - This asymmetry (stateful subscriptions + transactional state queries) is intentional
   */
  private setupSubscriptionHandlers(): void {
    if (!this.subscribeClient) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.subscribeClient as any;

    client.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.connected = false;
      this.lastError = err;
      this.confirmedChannels.clear();
      this.confirmedPatterns.clear();
      this.options.logger?.error?.("Subscribe client error:", err);
      const subError = new SubscribeError(`Connection error: ${err.message}`, {
        cause: err,
        retryable: true,
      });
      this.emit("error", subError);
      this.handleConnectionError(err);
    });

    client.on("end", () => {
      this.connected = false;
      this.confirmedChannels.clear();
      this.confirmedPatterns.clear();
      this.subscribeClient = null;
      this.options.logger?.warn?.("Subscribe client disconnected");
      this.emit("disconnect", { willReconnect: !this.destroyed });
      this.attemptReconnect();
    });
  }

  /**
   * Establish a subscription for a channel
   */
  private async establishSubscription(channel: string): Promise<void> {
    const client = await this.ensureSubscribeClient();

    // Use per-channel callback for messages (node-redis v4+)
    await client.subscribe?.(channel, (message: string | Buffer) => {
      this.handleMessage(channel, message);
    });

    // Mark channel as confirmed after successful subscription
    this.confirmedChannels.add(channel);
  }

  /**
   * Establish a subscription for a pattern
   */
  private async establishPatternSubscription(pattern: string): Promise<void> {
    const client = await this.ensureSubscribeClient();

    // Use per-pattern callback (node-redis v4+)
    await client.pSubscribe?.(
      pattern,
      (message: string | Buffer, actualChannel: string) => {
        this.handlePatternMessage(pattern, actualChannel, message);
      },
    );

    // Mark pattern as confirmed
    this.confirmedPatterns.add(pattern);
  }

  /**
   * Handle a message received from Redis
   *
   * NOTE: If deserialization fails, the entire message is dropped (not delivered to any handler).
   * If a handler throws, the error is logged but other handlers still receive the same message.
   * This ensures one bad handler doesn't starve the rest (fault isolation).
   */
  private handleMessage(channel: string, message: string | Buffer): void {
    const handlers = this.subscriptions.get(channel);
    if (!handlers) return;

    const messageStr =
      typeof message === "string" ? message : message.toString();

    let payload: unknown;
    try {
      payload = this.deserialize(messageStr);
    } catch (err) {
      const error = new DeserializationError(`Failed to deserialize message`, {
        cause: err instanceof Error ? err : undefined,
        channel,
      });
      this.options.logger?.error?.("Deserialization error:", error);
      return;
    }

    // Call all handlers; one throwing doesn't stop others
    const stripNamespace = (ch: string) => {
      if (this.namespace && ch.startsWith(this.namespace + ":")) {
        return ch.slice(this.namespace.length + 1);
      }
      return ch;
    };

    for (const handler of handlers) {
      try {
        handler(payload, { channel: stripNamespace(channel) });
      } catch (err) {
        this.options.logger?.error?.(
          `Handler error:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Handle a message received from a pattern subscription
   *
   * NOTE: Same fault isolation as handleMessage: if deserialization fails, the message is
   * dropped. If a handler throws, others still receive the message. Pattern handlers are
   * isolated from exact-channel handlers (they are separate subscription types).
   */
  private handlePatternMessage(
    pattern: string,
    actualChannel: string,
    message: string | Buffer,
  ): void {
    const handlers = this.patternSubscriptions.get(pattern);
    if (!handlers) return;

    const messageStr =
      typeof message === "string" ? message : message.toString();

    let payload: unknown;
    try {
      payload = this.deserialize(messageStr);
    } catch (err) {
      const error = new DeserializationError(
        `Failed to deserialize pattern message`,
        {
          cause: err instanceof Error ? err : undefined,
        },
      );
      this.options.logger?.error?.("Pattern deserialization error:", error);
      return;
    }

    // Call all pattern handlers
    const stripNamespace = (ch: string) => {
      if (this.namespace && ch.startsWith(this.namespace + ":")) {
        return ch.slice(this.namespace.length + 1);
      }
      return ch;
    };

    for (const handler of handlers) {
      try {
        handler(payload, { channel: stripNamespace(actualChannel) });
      } catch (err) {
        this.options.logger?.error?.(
          `Pattern handler error:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Unsubscribe from a channel on the subscribe client
   */
  private async unsubscribeFromChannel(channel: string): Promise<void> {
    if (this.subscribeClient?.isOpen) {
      await this.subscribeClient.unsubscribe?.(channel);
    }
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private async handleConnectionError(error: unknown): Promise<void> {
    this.connected = false;

    if (this.destroyed) {
      return;
    }

    this.options.logger?.error?.(
      `Connection error:`,
      error instanceof Error ? error.message : String(error),
    );

    this.attemptReconnect();
  }

  /**
   * Attempt to reconnect with exponential backoff
   *
   * NOTE: Uses exponential backoff formula: delay = initialMs * factor^(attempts-1).
   * Not linear multiplication. Example with factor=2: 100ms, 200ms, 400ms, 800ms, ...
   * Jitter (±10%) is added to prevent thundering herd (all clients reconnecting simultaneously).
   *
   * NOTE: If a reconnect is already scheduled and another error fires, we clear and reschedule
   * the timer. Only the most recent reconnect deadline matters. This prevents cascading timers
   * and keeps the reconnection logic predictable.
   */
  private attemptReconnect(): void {
    if (this.destroyed) {
      return;
    }

    // Check if max reconnect attempts exceeded
    if (
      this.maxReconnectAttempts !== "infinite" &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      this.options.logger?.error?.(
        `Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`,
      );
      return;
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff
    const factor = this.options.retry?.factor ?? 2;
    const baseDelay = Math.min(
      this.reconnectDelay * Math.pow(factor, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    // Apply jitter strategy to prevent thundering herd
    const jitterStrategy = this.options.retry?.jitter ?? "full";
    let jitteredDelay: number;

    if (jitterStrategy === "none") {
      jitteredDelay = baseDelay;
    } else if (jitterStrategy === "full") {
      // Full jitter: random value in [0, baseDelay]
      jitteredDelay = baseDelay * Math.random();
    } else {
      // Decorrelated jitter: min(cap, random(0, 3 * prev_delay))
      // For simplicity, use same as full jitter for now
      jitteredDelay = baseDelay * Math.random();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delayMs = Math.round(jitteredDelay);
    this.options.logger?.info?.(
      `Reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempts})`,
    );
    // Emit before delay so dashboards can show pending reconnection
    this.emit("reconnecting", { delayMs, attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (this.destroyed) {
        return;
      }

      // Clear clients to force reconnect (idempotent if already null)
      this.publishClient = null;
      this.subscribeClient = null;

      // Establish both connections and restore subscriptions (happens in ensureSubscribeClient)
      Promise.all([
        this.ensurePublishClient().catch(() => {
          // Error already reported by ensurePublishClient
        }),
        this.desiredChannels.size > 0 || this.desiredPatterns.size > 0
          ? this.ensureSubscribeClient().catch(() => {
              // Error already reported by ensureSubscribeClient
            })
          : Promise.resolve(),
      ]).then(() => {
        // Emit after both connections + resubscriptions complete (for SLO tracking)
        if (!this.destroyed) {
          this.emit("reconnected");
        }
      });
    }, jitteredDelay);
  }

  /**
   * Prefix a channel name with the namespace
   *
   * If namespace is set (e.g., "app"), prepends it with colon.
   * Example: channel="room:42" → "app:room:42"
   *
   * **Invariant: Guards against accidental double-prefixing**
   * Idempotent prefixing is a silent bug—user passes "app:ch" when namespace="app",
   * expecting "app:app:ch" (wrong) or thinking it's already handled (silent failure).
   * Fail-fast (throw) reveals the mistake immediately and forces use of ns() helper.
   *
   * Example: namespace="app", channel="app:room:42" → TypeError (caught at subscribe/publish time)
   */
  private prefixChannel(channel: string): string {
    if (!this.namespace) {
      return channel;
    }
    const expectedPrefix = this.namespace + ":";
    if (channel.startsWith(expectedPrefix)) {
      throw new TypeError(
        `Channel "${channel}" is already prefixed with namespace "${this.namespace}". Do not double-prefix.`,
      );
    }
    return `${this.namespace}:${channel}`;
  }

  /**
   * Serialize a message for Redis transmission.
   *
   * All modes produce strings (Redis pub/sub requirement).
   * - "json": JSON.stringify (strings are quoted)
   * - "text": must be a string (no conversion)
   * - "binary": Buffer/Uint8Array → base64 string
   * - custom: `encode(msg) => string`
   *
   * Strict mode: no type coercion. Errors immediately on contract violation.
   */
  private serialize(message: unknown): string {
    try {
      if (this.serializer === "json") {
        // Strict JSON: everything gets stringified, including strings
        return JSON.stringify(message);
      } else if (this.serializer === "text") {
        // Strict text: must be a string; no coercion
        if (typeof message !== "string") {
          throw new SerializationError(
            `Text serializer requires a string, got ${typeof message}`,
          );
        }
        return message;
      } else if (this.serializer === "binary") {
        // Binary mode: Buffer/Uint8Array → base64 string (Redis wire format)
        if (Buffer.isBuffer(message)) {
          return message.toString("base64");
        } else if (message instanceof Uint8Array) {
          return Buffer.from(message).toString("base64");
        } else {
          throw new SerializationError(
            `Binary serializer requires Buffer or Uint8Array, got ${typeof message}`,
          );
        }
      } else {
        // Custom serializer; must return string
        const encoded = this.serializer.encode(message);
        if (typeof encoded !== "string") {
          throw new SerializationError(
            `Custom serializer.encode() must return a string, got ${typeof encoded}`,
          );
        }
        return encoded;
      }
    } catch (error) {
      if (error instanceof PubSubError) {
        throw error;
      }
      throw new SerializationError(
        `Serialization failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  }

  /**
   * Deserialize a message from Redis (receives string from wire).
   *
   * Mirror of serialize() with strict contract. **Must match sender's serializer configuration.**
   * If sender used "json" and receiver uses "text", you get literal quoted string: `"\"hello\""`.
   * Always coordinate configuration between sender and receiver.
   *
   * - "json": JSON.parse
   * - "text": return as-is (string)
   * - "binary": base64 string → Buffer
   * - custom: `decode(wire_string) => unknown`
   */
  private deserialize(message: string): unknown {
    try {
      if (this.serializer === "json") {
        // Strict JSON: parse everything
        return JSON.parse(message);
      } else if (this.serializer === "text") {
        // Strict text: return as-is (already a string from wire)
        return message;
      } else if (this.serializer === "binary") {
        // Binary mode: decode base64 string → Buffer
        return Buffer.from(message, "base64");
      } else {
        // Custom deserializer
        return this.serializer.decode(message);
      }
    } catch (error) {
      if (error instanceof PubSubError) {
        throw error;
      }
      throw new DeserializationError(
        `Deserialization failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  }
}

/**
 * Factory function to create a RedisPubSub instance
 */
export function createRedisPubSub(options?: RedisPubSubOptions): RedisPubSub {
  return new RedisPubSub(options);
}

/**
 * Validate RedisPubSubOptions: reject unknown keys and incompatible combinations.
 * Throws TypeError on invalid options.
 *
 * Design Rationale: Strict validation prevents silent type drift and catches
 * typos early. Unknown keys are always rejected (no silent ignoring).
 */
function validateOptions(options: RedisPubSubOptions): void {
  const allowedKeys = new Set([
    "url",
    "client",
    "namespace",
    "serializer",
    "retry",
    "maxSubscriptions",
    "logger",
    "isRetryable",
  ]);

  const givenKeys = Object.keys(options);
  for (const key of givenKeys) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(
        `Unknown option "${key}". Allowed options: ${Array.from(allowedKeys).join(", ")}`,
      );
    }
  }

  // Validate mutually exclusive options: either url or client, not both
  if (options.url && options.client) {
    throw new TypeError(
      'Options "url" and "client" are mutually exclusive. Use one or the other.',
    );
  }
}

/**
 * Validate namespace format: must match /^[A-Za-z0-9][A-Za-z0-9:_-]*$/
 * Throws TypeError on invalid format.
 */
function validateNamespace(ns: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(ns)) {
    throw new TypeError(
      `Invalid namespace "${ns}". Namespace must start with alphanumeric and contain only alphanumerics, colons, underscores, and hyphens.`,
    );
  }
}

/**
 * Normalize namespace: accept "app", "app:", " app : " → "app"
 * - Trims whitespace
 * - Strips trailing colons and spaces
 * - Validates format
 */
function normalizeNamespace(ns?: string): string {
  if (!ns) return "";
  let normalized = ns.trim();

  // Remove trailing colons, underscores, and whitespace
  // Using a simple loop avoids regex complexity and is obviously O(n) safe
  while (normalized.length > 0 && /[:_\s]/.test(normalized.slice(-1))) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.length === 0) return "";
  validateNamespace(normalized);
  return normalized;
}

/**
 * Check if an error is a transient network error (retryable)
 *
 * Design: Explicit allow-list prevents infinite retry on permanent failures (auth, config).
 * Checks error.code/name before message to catch errors reliably across clients.
 * Defaults unknown errors to non-retryable (safer than infinite retry).
 */
const RETRYABLE_ERROR_CODES = new Set([
  // Network errors
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  // Redis transient state errors (will self-resolve)
  "READONLY", // replica failover; leader will be elected
  "NR_CROSS_SLOT", // cluster slot migration in progress
  "LOADING", // Redis server starting up
]);

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false; // Unknown errors default to non-retryable
  }

  // Check error.code first (Node.js system errors use this; more reliable than message)
  const errWithCode = error as NodeJS.ErrnoException | Record<string, unknown>;
  const code = errWithCode.code;
  if (code && RETRYABLE_ERROR_CODES.has(String(code))) {
    return true;
  }

  // Check error.name (some Redis clients may use this instead of code)
  const name = errWithCode.name;
  if (name && RETRYABLE_ERROR_CODES.has(String(name))) {
    return true;
  }

  // Fallback: match against message (least reliable, but catches edge cases)
  const message = (error.message || "").toUpperCase();
  for (const code of RETRYABLE_ERROR_CODES) {
    if (message.includes(code)) {
      return true;
    }
  }

  return false;
}
