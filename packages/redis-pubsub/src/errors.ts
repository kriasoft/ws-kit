/**
 * Base error class for RedisPubSub
 */
export class RedisPubSubError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "RedisPubSubError";
    Object.setPrototypeOf(this, RedisPubSubError.prototype);
  }
}

/**
 * Error thrown when Redis connection fails
 */
export class RedisConnectionError extends RedisPubSubError {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message, "REDIS_CONNECTION_ERROR");
    this.name = "RedisConnectionError";
    Object.setPrototypeOf(this, RedisConnectionError.prototype);
  }
}

/**
 * Error thrown when a publish operation fails
 */
export class RedisPublishError extends RedisPubSubError {
  constructor(
    message: string,
    public readonly channel: string,
    public readonly originalError?: Error,
  ) {
    super(message, "REDIS_PUBLISH_ERROR");
    this.name = "RedisPublishError";
    Object.setPrototypeOf(this, RedisPublishError.prototype);
  }
}

/**
 * Error thrown when a subscribe operation fails
 */
export class RedisSubscribeError extends RedisPubSubError {
  constructor(
    message: string,
    public readonly channel: string,
    public readonly originalError?: Error,
  ) {
    super(message, "REDIS_SUBSCRIBE_ERROR");
    this.name = "RedisSubscribeError";
    Object.setPrototypeOf(this, RedisSubscribeError.prototype);
  }
}

/**
 * Error thrown when message serialization fails
 */
export class SerializationError extends RedisPubSubError {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message, "SERIALIZATION_ERROR");
    this.name = "SerializationError";
    Object.setPrototypeOf(this, SerializationError.prototype);
  }
}

/**
 * Error thrown when message deserialization fails
 */
export class DeserializationError extends RedisPubSubError {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message, "DESERIALIZATION_ERROR");
    this.name = "DeserializationError";
    Object.setPrototypeOf(this, DeserializationError.prototype);
  }
}
