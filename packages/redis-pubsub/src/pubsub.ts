import type { PubSub } from "@ws-kit/core";
import type { RedisClient } from "./types.js";
import {
  RedisConnectionError,
  RedisPublishError,
  RedisSubscribeError,
  SerializationError,
  DeserializationError,
} from "./errors.js";
import type { RedisPubSubOptions, MessageHandler } from "./types.js";

/**
 * RedisPubSub implementation using Redis pub/sub
 *
 * Enables broadcasting across multiple server instances (Bun cluster, Node.js cluster, etc).
 * Each instance connects to the same Redis server and subscribes to relevant channels.
 * Messages are published to Redis and delivered to all subscribers.
 *
 * Features:
 * - Automatic connection establishment (lazy)
 * - Automatic reconnection with exponential backoff
 * - Channel namespace support for multi-tenancy
 * - Custom message serialization
 * - Error callbacks and lifecycle hooks
 */
export class RedisPubSub implements PubSub {
  private publishClient: RedisClient | null = null;
  private subscribeClient: RedisClient | null = null;
  private subscriptions = new Map<string, Set<MessageHandler>>();
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectDelay = 100;
  private maxReconnectDelay: number;
  private namespace: string;
  private options: RedisPubSubOptions;
  private destroyed = false;

  constructor(options: RedisPubSubOptions = {}) {
    this.options = options;
    this.namespace = options.namespace ?? "ws";
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
  }

  /**
   * Publish a message to a channel
   * Creates publish client on first call (lazy initialization)
   */
  async publish(channel: string, message: unknown): Promise<void> {
    if (this.destroyed) {
      throw new RedisConnectionError("RedisPubSub has been destroyed");
    }

    const prefixed = this.prefixChannel(channel);

    try {
      if (!this.publishClient) {
        await this.ensurePublishClient();
      }

      const serialized = this.serialize(message);
      await (this.publishClient as RedisClient).publish?.(prefixed, serialized);
    } catch (error) {
      // Reset client on error - will be reconnected on next call
      this.publishClient = null;

      const err = error instanceof Error ? error : new Error(String(error));
      const pubError = new RedisPublishError(
        `Failed to publish to channel "${channel}": ${err.message}`,
        channel,
        err,
      );

      this.options.onError?.(pubError);
      throw pubError;
    }
  }

  /**
   * Subscribe to a channel
   * Creates subscribe client on first subscription (lazy initialization)
   */
  subscribe(channel: string, handler: MessageHandler): void {
    if (this.destroyed) {
      throw new RedisConnectionError(
        "Cannot subscribe: RedisPubSub has been destroyed",
      );
    }

    const prefixed = this.prefixChannel(channel);

    if (!this.subscriptions.has(prefixed)) {
      this.subscriptions.set(prefixed, new Set());

      // Async subscription - errors logged via onError callback
      this.subscribeToChannel(prefixed).catch((error) => {
        const subError = new RedisSubscribeError(
          `Failed to subscribe to channel "${channel}": ${error instanceof Error ? error.message : String(error)}`,
          channel,
          error instanceof Error ? error : undefined,
        );
        this.options.onError?.(subError);
      });
    }

    const handlers = this.subscriptions.get(prefixed);
    if (handlers) {
      handlers.add(handler);
    }
  }

  /**
   * Unsubscribe a handler from a channel
   */
  unsubscribe(channel: string, handler: MessageHandler): void {
    const prefixed = this.prefixChannel(channel);
    const handlers = this.subscriptions.get(prefixed);

    if (handlers) {
      handlers.delete(handler);

      // If no more handlers, unsubscribe from channel
      if (handlers.size === 0) {
        this.subscriptions.delete(prefixed);

        if (this.subscribeClient?.isOpen) {
          this.unsubscribeFromChannel(prefixed).catch((error) => {
            this.options.onError?.(
              new RedisSubscribeError(
                `Failed to unsubscribe from channel "${channel}"`,
                channel,
                error instanceof Error ? error : undefined,
              ),
            );
          });
        }
      }
    }
  }

  /**
   * Destroy the RedisPubSub instance and cleanup connections
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.subscriptions.clear();

    const promises: Promise<unknown>[] = [];

    if (this.publishClient?.isOpen) {
      const quitPromise = this.publishClient.quit?.();
      if (quitPromise) {
        promises.push(
          quitPromise.catch(() => {
            /* ignore */
          }),
        );
      }
    }

    if (this.subscribeClient?.isOpen) {
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
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected && this.publishClient?.isOpen === true;
  }

  // ========== Private Methods ==========

  /**
   * Ensure publish client is connected
   */
  private async ensurePublishClient(): Promise<RedisClient> {
    if (this.publishClient?.isOpen) {
      return this.publishClient;
    }

    try {
      this.publishClient = await this.createClient();
      this.reconnectAttempts = 0;
      this.reconnectDelay = 100;
      this.connected = true;
      this.options.onConnect?.();
      return this.publishClient;
    } catch (error) {
      await this.handleConnectionError(error);
      throw new RedisConnectionError(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
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
      this.subscribeClient = await this.createClient();
      this.setupSubscriptionHandlers();
      this.reconnectAttempts = 0;
      this.reconnectDelay = 100;
      return this.subscribeClient;
    } catch (error) {
      await this.handleConnectionError(error);
      throw new RedisSubscribeError(
        "Failed to connect subscribe client",
        "",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Create a new Redis client
   */
  private async createClient(): Promise<RedisClient> {
    // Use pre-configured client if provided
    if (this.options.client) {
      if (!this.options.client.isOpen) {
        await this.options.client.connect?.();
      }
      return this.options.client;
    }

    // Dynamically import redis module (peer dependency)
    let createClient;
    try {
      const redisModule = await import("redis");
      createClient = redisModule.createClient;
    } catch {
      throw new RedisConnectionError(
        "redis module not found. Install it with: npm install redis",
      );
    }

    // Build connection options
    const clientOptions: Record<string, string | number | boolean | object> =
      {};

    if (this.options.url) {
      clientOptions.url = this.options.url;
    } else {
      clientOptions.socket = {
        host: this.options.host ?? "localhost",
        port: this.options.port ?? 6379,
        tls: this.options.tls ?? false,
      };

      if (this.options.password) {
        clientOptions.password = this.options.password;
      }

      if (this.options.db !== undefined) {
        clientOptions.database = this.options.db;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createClient(clientOptions) as any as RedisClient;
    await client.connect?.();
    return client;
  }

  /**
   * Setup message handlers for subscribe client
   */
  private setupSubscriptionHandlers(): void {
    if (!this.subscribeClient) return;

    // Redis pub/sub emits "message" event with (channel, message) signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.subscribeClient as any;

    client.on("message", (channel: string, message: string) => {
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        try {
          const deserialized = this.deserialize(message);
          handlers.forEach((handler) => {
            try {
              handler(deserialized);
            } catch (err) {
              this.options.onError?.(
                err instanceof Error ? err : new Error(String(err)),
              );
            }
          });
        } catch (err) {
          this.options.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    });

    client.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.connected = false;
      this.options.onError?.(err);
      this.handleConnectionError(err);
    });

    client.on("end", () => {
      this.connected = false;
      this.subscribeClient = null;
      this.options.onDisconnect?.();
      this.attemptReconnect();
    });
  }

  /**
   * Subscribe to a channel on the subscribe client
   */
  private async subscribeToChannel(channel: string): Promise<void> {
    const client = await this.ensureSubscribeClient();

    await client.subscribe?.(channel, () => {
      // Subscription callback - no-op
    });
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

    this.options.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );

    this.attemptReconnect();
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.destroyed || this.reconnectAttempts > 10) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    setTimeout(() => {
      if (!this.destroyed) {
        // Trigger reconnection on next publish/subscribe
        this.publishClient = null;
        this.subscribeClient = null;
      }
    }, delay);
  }

  /**
   * Prefix a channel name with the namespace
   */
  private prefixChannel(channel: string): string {
    return `${this.namespace}:${channel}`;
  }

  /**
   * Serialize a message for Redis
   */
  private serialize(message: unknown): string {
    if (this.options.serializeMessage) {
      try {
        return this.options.serializeMessage(message);
      } catch (error) {
        throw new SerializationError(
          `Custom serialization failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined,
        );
      }
    }

    // Default serialization
    if (typeof message === "string") {
      return message;
    }

    if (message instanceof Uint8Array || message instanceof ArrayBuffer) {
      // Convert binary to base64
      const buffer =
        message instanceof ArrayBuffer ? new Uint8Array(message) : message;
      return Buffer.from(buffer).toString("base64");
    }

    // Default: JSON stringify
    try {
      return JSON.stringify(message);
    } catch (error) {
      throw new SerializationError(
        `Failed to serialize message: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Deserialize a message from Redis
   */
  private deserialize(message: string): unknown {
    if (this.options.deserializeMessage) {
      try {
        return this.options.deserializeMessage(message);
      } catch (error) {
        throw new DeserializationError(
          `Custom deserialization failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined,
        );
      }
    }

    // Try JSON parsing first
    try {
      return JSON.parse(message);
    } catch {
      // If JSON parsing fails, try base64 decode
      try {
        return Buffer.from(message, "base64");
      } catch {
        // If all fails, return as string
        return message;
      }
    }
  }
}
