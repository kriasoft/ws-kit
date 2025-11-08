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
      logger: {
        info: console.log,
        warn: console.warn,
        error: console.error,
      },
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

  test("Subscription.unsubscribe() removes handler", () => {
    const pubsub = new RedisPubSub();

    const handler = (msg: unknown) => {
      /* no-op */
    };

    const sub = pubsub.subscribe("test:channel", handler);
    expectTypeOf(sub.unsubscribe).toBeFunction();
    sub.unsubscribe();
  });

  test("RedisPubSub options support custom serialization", () => {
    const options: RedisPubSubOptions = {
      serializer: {
        encode: (msg) => {
          expectTypeOf(msg).toBeUnknown();
          return JSON.stringify(msg);
        },
        decode: (msg) => {
          expectTypeOf(msg).toBeString();
          return JSON.parse(msg);
        },
      },
    };

    expectTypeOf(options).toMatchTypeOf<RedisPubSubOptions>();
  });

  test("RedisPubSub options support pre-configured client", () => {
    // Note: This type test doesn't need an actual Redis client instance
    // Just verifies the options can accept a client-like object
    interface ClientLike {
      isOpen?: boolean;
      connect?(): Promise<void>;
      quit?(): Promise<void>;
      publish?(channel: string, message: string): Promise<unknown>;
      subscribe?(
        channel: string,
        listener: (message: string | Buffer) => void,
      ): Promise<unknown>;
      unsubscribe?(channel: string): Promise<unknown>;
      on?(event: string, handler: (data: unknown) => void): void;
    }

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

  test("Event listeners receive proper error types", () => {
    const pubsub = new RedisPubSub();

    const unsubError = pubsub.on("error", (error) => {
      expectTypeOf(error).toBeInstanceOf(Error);
      expectTypeOf(error.message).toBeString();
    });

    expectTypeOf(unsubError).toBeFunction();
  });

  test("isConnected method exists and returns boolean", () => {
    const pubsub = new RedisPubSub();
    expectTypeOf(pubsub.isConnected).toBeFunction();
    expectTypeOf(pubsub.isConnected()).toBeBoolean();
  });

  test("close method returns promise", () => {
    const pubsub = new RedisPubSub();
    expectTypeOf(pubsub.close).toBeFunction();
    expectTypeOf(pubsub.close()).resolves.toBeVoid();
  });
});
