/**
 * Unified error code type for RedisPubSub
 */
export type PubSubErrorCode =
  | "PUBLISH_FAILED"
  | "SUBSCRIBE_FAILED"
  | "SERIALIZATION_ERROR"
  | "DESERIALIZATION_ERROR"
  | "DISCONNECTED"
  | "CONFIGURATION_ERROR"
  | "MAX_SUBSCRIPTIONS_EXCEEDED";

/**
 * Base error class for RedisPubSub
 *
 * All public API methods throw errors that extend this class.
 * Check the `code` field for specific error types and `retryable` to decide retry strategy.
 */
export class PubSubError extends Error {
  /**
   * Error code for programmatic handling
   */
  declare readonly code: PubSubErrorCode;

  /**
   * Whether this error is transient and safe to retry
   * - true: network/connection issues; retry with backoff
   * - false: permanent issues (serialization, destroyed instance, etc.); don't retry
   */
  retryable: boolean;

  /**
   * Original error that caused this, if any (network error, etc.)
   */
  override cause?: unknown;

  /**
   * Relevant channel name, if applicable
   */
  channel?: string | undefined;

  constructor(
    message: string,
    options?: {
      code?: PubSubErrorCode;
      retryable?: boolean;
      cause?: unknown;
      channel?: string;
    },
  ) {
    super(message);
    this.name = "PubSubError";
    this.code = options?.code ?? "PUBLISH_FAILED";
    this.retryable = options?.retryable ?? false;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    this.channel = options?.channel;
    Object.setPrototypeOf(this, PubSubError.prototype);
  }
}

/**
 * Publish operation failed
 */
export class PublishError extends PubSubError {
  declare readonly code: "PUBLISH_FAILED";

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      cause?: unknown;
      channel?: string;
    },
  ) {
    super(message, { code: "PUBLISH_FAILED", ...options });
    this.name = "PublishError";
    Object.setPrototypeOf(this, PublishError.prototype);
  }
}

/**
 * Subscribe operation failed
 */
export class SubscribeError extends PubSubError {
  declare readonly code: "SUBSCRIBE_FAILED";

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      cause?: unknown;
      channel?: string;
    },
  ) {
    super(message, { code: "SUBSCRIBE_FAILED", ...options });
    this.name = "SubscribeError";
    Object.setPrototypeOf(this, SubscribeError.prototype);
  }
}

/**
 * Message serialization failed
 */
export class SerializationError extends PubSubError {
  declare readonly code: "SERIALIZATION_ERROR";

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      channel?: string;
    },
  ) {
    super(message, {
      code: "SERIALIZATION_ERROR",
      retryable: false,
      ...options,
    });
    this.name = "SerializationError";
    Object.setPrototypeOf(this, SerializationError.prototype);
  }
}

/**
 * Message deserialization failed
 */
export class DeserializationError extends PubSubError {
  declare readonly code: "DESERIALIZATION_ERROR";

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      channel?: string;
    },
  ) {
    super(message, {
      code: "DESERIALIZATION_ERROR",
      retryable: false,
      ...options,
    });
    this.name = "DeserializationError";
    Object.setPrototypeOf(this, DeserializationError.prototype);
  }
}

/**
 * Instance is disconnected or destroyed
 */
export class DisconnectedError extends PubSubError {
  declare readonly code: "DISCONNECTED";

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "DISCONNECTED",
      retryable: options?.retryable ?? true,
      ...options,
    });
    this.name = "DisconnectedError";
    Object.setPrototypeOf(this, DisconnectedError.prototype);
  }
}

/**
 * Configuration error (invalid options or missing required capability)
 */
export class ConfigurationError extends PubSubError {
  declare readonly code: "CONFIGURATION_ERROR";

  constructor(
    message: string,
    options?: {
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "CONFIGURATION_ERROR",
      retryable: false,
      ...options,
    });
    this.name = "ConfigurationError";
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Maximum subscriptions limit exceeded
 */
export class MaxSubscriptionsExceededError extends PubSubError {
  declare readonly code: "MAX_SUBSCRIPTIONS_EXCEEDED";

  constructor(
    message: string,
    public readonly limit: number,
  ) {
    super(message, { code: "MAX_SUBSCRIPTIONS_EXCEEDED", retryable: false });
    this.name = "MaxSubscriptionsExceededError";
    Object.setPrototypeOf(this, MaxSubscriptionsExceededError.prototype);
  }
}
