/**
 * Redis client type (duck-typed for compatibility with redis v4+)
 */
export interface RedisClient {
  isOpen?: boolean;
  connect?(): Promise<void>;
  quit?(): Promise<void>;
  publish?(channel: string, message: string): Promise<unknown>;
  subscribe?(channel: string, callback: () => void): Promise<unknown>;
  unsubscribe?(channel: string): Promise<unknown>;
  on?(event: string, handler: (data: unknown) => void): void;
}

/**
 * Options for configuring RedisPubSub
 */
export interface RedisPubSubOptions {
  /**
   * Redis connection URL (e.g., "redis://localhost:6379")
   * Takes precedence over individual host/port/password options.
   */
  url?: string;

  /**
   * Redis server hostname (default: "localhost")
   */
  host?: string;

  /**
   * Redis server port (default: 6379)
   */
  port?: number;

  /**
   * Redis server password
   */
  password?: string;

  /**
   * Redis database number (default: 0)
   */
  db?: number;

  /**
   * Enable TLS for connection
   */
  tls?: boolean;

  /**
   * Pre-configured Redis client instance.
   * If provided, all connection options are ignored and this client is used instead.
   */
  client?: RedisClient;

  /**
   * Channel namespace prefix (default: "ws")
   * Used to prevent channel collisions in multi-tenant setups.
   * Actual channel names will be prefixed as: `{namespace}:{channel}`
   */
  namespace?: string;

  /**
   * Called when connection is established
   */
  onConnect?: () => void;

  /**
   * Called when an error occurs
   */
  onError?: (error: Error) => void;

  /**
   * Called when connection is lost
   */
  onDisconnect?: () => void;

  /**
   * Maximum delay between reconnection attempts in milliseconds (default: 30000)
   */
  maxReconnectDelay?: number;

  /**
   * Custom message serialization function
   * @param message The message to serialize
   * @returns Serialized message as string
   */
  serializeMessage?: (message: unknown) => string;

  /**
   * Custom message deserialization function
   * @param message The serialized message string
   * @returns Deserialized message
   */
  deserializeMessage?: (message: string) => unknown;
}

/**
 * Message handler function type
 */
export type MessageHandler = (message: unknown) => void;

/**
 * Serialization result for messages
 */
export interface SerializationResult {
  success: boolean;
  data?: string;
  error?: Error;
}

/**
 * Deserialization result for messages
 */
export interface DeserializationResult {
  success: boolean;
  data?: unknown;
  error?: Error;
}
