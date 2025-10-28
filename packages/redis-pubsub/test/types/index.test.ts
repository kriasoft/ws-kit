import { describe, test } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { PubSub } from "@ws-kit/core";
import { createRedisPubSub, RedisPubSub } from "@ws-kit/redis-pubsub";
import type { RedisPubSubOptions } from "@ws-kit/redis-pubsub";

describe("RedisPubSub Types", () => {
  test("RedisPubSub implements PubSub interface", () => {
    const pubsub = createRedisPubSub();
    expectTypeOf(pubsub).toMatchTypeOf<PubSub>();
  });

  test("createRedisPubSub returns PubSub instance", () => {
    const pubsub = createRedisPubSub({ namespace: "test" });
    expectTypeOf(pubsub).toMatchTypeOf<PubSub>();
  });

  test("createRedisPubSub accepts RedisPubSubOptions", () => {
    const options: RedisPubSubOptions = {
      url: "redis://localhost:6379",
      namespace: "myapp",
      onConnect: () => {},
      onError: (err) => {
        expectTypeOf(err).toBeInstanceOf(Error);
      },
      onDisconnect: () => {},
    };

    const pubsub = createRedisPubSub(options);
    expectTypeOf(pubsub).toMatchTypeOf<PubSub>();
  });

  test("RedisPubSub.publish() accepts channel string and message", () => {
    const pubsub = new RedisPubSub();

    expectTypeOf(pubsub.publish).toBeFunction();
    expectTypeOf(
      pubsub.publish("test:channel", { data: "test" }),
    ).resolves.toBeVoid();
  });

  test("RedisPubSub.subscribe() accepts channel and handler", () => {
    const pubsub = new RedisPubSub();

    expectTypeOf(pubsub.subscribe).toBeFunction();

    const handler = (msg: unknown) => {
      expectTypeOf(msg).toBeUnknown();
    };

    pubsub.subscribe("test:channel", handler);
  });

  test("RedisPubSub.unsubscribe() removes handler", () => {
    const pubsub = new RedisPubSub();

    const handler = (msg: unknown) => {
      /* no-op */
    };

    pubsub.subscribe("test:channel", handler);
    pubsub.unsubscribe("test:channel", handler);
  });

  test("RedisPubSub options support custom serialization", () => {
    const options: RedisPubSubOptions = {
      serializeMessage: (msg) => {
        expectTypeOf(msg).toBeUnknown();
        return JSON.stringify(msg);
      },
      deserializeMessage: (msg) => {
        expectTypeOf(msg).toBeString();
        return JSON.parse(msg);
      },
    };

    expectTypeOf(options).toMatchTypeOf<RedisPubSubOptions>();
  });

  test("RedisPubSub options support pre-configured client", () => {
    // Note: This type test doesn't need an actual Redis client instance
    // Just verifies the options can accept a client-like object
    type ClientLike = {
      isOpen?: boolean;
      connect?(): Promise<void>;
      quit?(): Promise<void>;
      publish?(channel: string, message: string): Promise<unknown>;
      subscribe?(channel: string, callback: () => void): Promise<unknown>;
      unsubscribe?(channel: string): Promise<unknown>;
      on?(event: string, handler: (data: unknown) => void): void;
    };

    const options: RedisPubSubOptions = {
      // TypeScript allows duck typing - actual Redis client would work here
      client: undefined as any as ClientLike,
    };

    expectTypeOf(options).toMatchTypeOf<RedisPubSubOptions>();
  });

  test("RedisPubSub namespace defaults properly", () => {
    const pubsub1 = new RedisPubSub();
    expectTypeOf(pubsub1).toMatchTypeOf<PubSub>();

    const pubsub2 = new RedisPubSub({ namespace: "custom" });
    expectTypeOf(pubsub2).toMatchTypeOf<PubSub>();
  });

  test("Error callbacks receive Error type", () => {
    const options: RedisPubSubOptions = {
      onError: (error) => {
        expectTypeOf(error).toBeInstanceOf(Error);
        expectTypeOf(error.message).toBeString();
      },
    };

    expectTypeOf(options.onError).toBeFunction();
  });

  test("isConnected method exists and returns boolean", () => {
    const pubsub = new RedisPubSub();
    expectTypeOf(pubsub.isConnected).toBeFunction();
    expectTypeOf(pubsub.isConnected()).toBeBoolean();
  });

  test("destroy method returns promise", () => {
    const pubsub = new RedisPubSub();
    expectTypeOf(pubsub.destroy).toBeFunction();
    expectTypeOf(pubsub.destroy()).resolves.toBeVoid();
  });
});
