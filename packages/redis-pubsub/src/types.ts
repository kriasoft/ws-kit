import type { PubSubError } from "./errors.js";

/**
 * Redis client type (duck-typed for compatibility with redis v4+)
 * Represents a minimal interface that compatible Redis clients must implement.
 */
export interface RedisClient {
  isOpen?: boolean;
  connect?(): Promise<void>;
  quit?(): Promise<void>;
  publish?(channel: string, message: string): Promise<unknown>;
  subscribe?(
    channel: string,
    listener: (message: string | Buffer) => void,
  ): Promise<unknown>;
  pSubscribe?(
    pattern: string,
    listener: (message: string | Buffer, channel: string) => void,
  ): Promise<unknown>;
  unsubscribe?(channel: string): Promise<unknown>;
  pUnsubscribe?(pattern: string): Promise<unknown>;
  on?(event: string, handler: (data: unknown) => void): void;
  duplicate?(): RedisClient;
}

/**
 * Options for configuring RedisPubSub
 */
export interface RedisPubSubOptions {
  /**
   * Redis connection URL (e.g., "redis://localhost:6379" or "rediss://localhost:6379" for TLS)
   */
  url?: string;

  /**
   * Pre-configured Redis client instance.
   * If provided, all connection options (url, etc.) are ignored and this client is used instead.
   * RedisPubSub will not call quit() on user-owned clients; you own the lifecycle.
   */
  client?: RedisClient;

  /**
   * Channel namespace prefix (default: "" — no prefix)
   * If set, all channel names are prefixed as `{namespace}:{channel}`
   * Prevents channel collisions in multi-tenant setups.
   * Guards against double-prefixing (e.g., passing "app:ch" when namespace="app" throws TypeError).
   */
  namespace?: string;

  /**
   * Message serialization strategy. All modes transmit strings over Redis (JSON protocol requirement).
   *
   * - "json" (default): JSON.stringify on send, JSON.parse on receive. Strings are quoted.
   *   Example: `publish("ch", "hello")` → wire: `"\"hello\""` → receive: `"hello"`
   *
   * - "text": message must be a string (no conversion). Sent/received as-is.
   *   Example: `publish("ch", "hello")` → wire: `"hello"` → receive: `"hello"`
   *   Throws SerializationError if non-string passed.
   *
   * - "binary": message must be Buffer/Uint8Array. Encoded as base64 on wire for Redis transmission.
   *   Example: `publish("ch", Buffer.from([1,2,3]))` → wire: `"AQID"` (base64) → receive: `Buffer.from([1,2,3])`
   *   Throws SerializationError if non-binary passed.
   *
   * - custom: `{ encode, decode }` completely replaces default pipeline. `encode` must return a string.
   *   Compose serializers for domain-specific encoding if needed.
   */
  serializer?:
    | "json"
    | "text"
    | "binary"
    | {
        encode: (msg: unknown) => string;
        decode: (s: string) => unknown;
      };

  /**
   * Reconnection behavior (exponential backoff with optional jitter)
   */
  retry?: {
    /** Initial delay in milliseconds (default: 100) */
    initialMs?: number;
    /** Backoff multiplier (default: 2) */
    factor?: number;
    /** Maximum delay cap in milliseconds (default: 30000) */
    maxMs?: number;
    /** Jitter strategy to prevent thundering herd:
     * - "full": random jitter [0, delay] (default, highly recommended)
     * - "none": no jitter (predictable but risks synchronized reconnects)
     * - "decorrelated": decorrelated jitter (more advanced strategy)
     */
    jitter?: "full" | "none" | "decorrelated";
    /** Maximum reconnection attempts; "infinite" for unlimited (default: "infinite") */
    maxAttempts?: number | "infinite";
  };

  /**
   * Safety limit: maximum number of concurrent subscriptions (default: Infinity)
   * Throws MAX_SUBSCRIPTIONS_EXCEEDED if exceeded.
   */
  maxSubscriptions?: number;

  /**
   * Optional observability sink. Never logs by default.
   * Only invoked if provided. Useful for integrating with external loggers.
   */
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };

  /**
   * Optional custom error classification for retry decisions.
   * Called during publish/subscribe failures; result determines `error.retryable` flag.
   * If not provided, defaults to checking well-known network error codes.
   * Useful for advanced users integrating custom Redis clients or observability.
   *
   * @example
   * ```typescript
   * isRetryable: (err) => {
   *   if (err instanceof MyCustomTimeout) return true;
   *   if (err instanceof MyCustomPermanent) return false;
   *   // fallback to default logic
   *   return undefined;
   * }
   * ```
   */
  isRetryable?: (err: unknown) => boolean | undefined;
}

/**
 * A single subscription (exact channel or pattern)
 *
 * - `channel`: The subscribed channel name or pattern
 * - `ready`: Resolves after Redis confirms the subscription (ACK)
 * - `unsubscribe()`: Detaches the handler (idempotent; safe to call multiple times)
 */
export interface Subscription {
  readonly channel: string;
  readonly ready: Promise<void>;
  unsubscribe(): void;
}

/**
 * Message handler function type with channel metadata
 * Handler receives both the message and metadata about which channel it came from
 */
export type MessageHandler = (
  message: unknown,
  meta: { channel: string },
) => void;

/**
 * Event handler type (for on/off methods)
 */
export type EventHandler = (...args: unknown[]) => void;

/**
 * Unsubscribe function type
 * Call to remove the subscription and stop receiving messages
 */
export type Unsubscribe = () => void;

/**
 * Result of a successful publishWithRetry() operation
 *
 * - `capability`: "unknown" (Redis Pub/Sub cannot report delivery count)
 * - `attempts`: Number of attempts performed (1 if no retry was needed)
 * - `durationMs`: Total time spent publishing (including retries and delays)
 */
export interface PublishResult {
  capability: "unknown" | "estimate" | "exact";
  matched?: number; // Only when capability !== "unknown"
  attempts: number;
  durationMs: number;
}

/**
 * Status snapshot of RedisPubSub instance
 */
export interface PubSubStatus {
  /**
   * Whether currently connected to Redis
   */
  connected: boolean;

  /**
   * Number of concurrent publish() calls in-flight (not buffered)
   */
  inflightPublishes: number;

  /**
   * Active subscriptions
   */
  channels: {
    /**
     * Exact channel names (excluding namespace prefix)
     */
    exact: string[];
    /**
     * Pattern subscriptions (excluding namespace prefix)
     */
    patterns: string[];
  };

  /**
   * Last error that occurred, if any (never auto-cleared)
   */
  lastError?: {
    code: string;
    message: string;
    at: number;
  };
}

/**
 * PubSub event union (strongly typed for IDE discoverability)
 *
 * Emitted by on() and caught by listeners.
 */
export type PubSubEvent =
  | { type: "connect" }
  | { type: "reconnecting"; attempt: number; delayMs: number }
  | { type: "reconnected" }
  | { type: "disconnect"; willReconnect: boolean }
  | { type: "error"; error: PubSubError };

/**
 * Event payloads for on() listeners (legacy compatibility)
 * Strongly typed for IDE discoverability
 */
export interface Events {
  connect: undefined;
  disconnect: { willReconnect: boolean };
  reconnecting: { attempt: number; delayMs: number };
  reconnected: undefined;
  error: PubSubError;
}

/**
 * Options for publish() (reserved for future extensions)
 * Currently unused; kept for API stability.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PublishOpts {}

/**
 * Options for subscribe() (exact channel subscriptions)
 * Reserved for future extensions.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SubscribeOpts {}

/**
 * Options for once() (exact channel, single message wait)
 */
export interface OnceOpts {
  /**
   * Maximum time to wait for the message
   * If exceeded, promise rejects with TimeoutError
   */
  timeoutMs?: number;
}

/**
 * Options for ponce() (pattern subscription, single message wait)
 */
export interface PonceOpts {
  /**
   * Maximum time to wait for the message
   * If exceeded, promise rejects with TimeoutError
   */
  timeoutMs?: number;
}

/**
 * Retry policy for publishWithRetry()
 */
export interface RetryPolicy {
  /**
   * Maximum publish attempts (default: 3)
   */
  maxAttempts?: number;

  /**
   * Initial backoff delay in milliseconds (default: 100)
   */
  initialDelayMs?: number;

  /**
   * Maximum backoff delay cap in milliseconds (default: 10_000)
   */
  maxDelayMs?: number;

  /**
   * Jitter strategy for backoff:
   * - "full": random jitter [0, delay] (default, prevents thundering herd)
   * - "none": no jitter (predictable but risks herd)
   * - "decorrelated": decorrelated jitter
   */
  jitter?: "full" | "none" | "decorrelated";

  /**
   * Optional callback invoked before each retry attempt
   */
  onAttempt?(attempt: number, delayMs: number, error: Error): void;
}
