// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, PublishResult } from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";
import { bunPubSub } from "./adapter.js";
import { createBunHandler } from "./handler.js";
import type {
  BunConnectionData,
  BunHandlerOptions,
  BunServerHandlers,
} from "./types.js";

describe("@ws-kit/bun type tests", () => {
  describe("bunPubSub", () => {
    it("should return PubSubAdapter", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = bunPubSub(mockServer);
      // Check that pubsub implements required PubSubAdapter interface methods
      expectTypeOf(pubsub).toHaveProperty("publish");
      expectTypeOf(pubsub).toHaveProperty("subscribe");
      expectTypeOf(pubsub).toHaveProperty("unsubscribe");
      expectTypeOf(pubsub).toHaveProperty("getSubscribers");
    });

    it("should have publish method with correct signature", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = bunPubSub(mockServer);

      expectTypeOf(pubsub.publish).toBeFunction();
      expectTypeOf(
        pubsub.publish,
      ).returns.resolves.toEqualTypeOf<PublishResult>();
    });

    it("should have subscribe method", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = bunPubSub(mockServer);

      expectTypeOf(pubsub.subscribe).toBeFunction();
    });

    it("should have unsubscribe method", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = bunPubSub(mockServer);

      expectTypeOf(pubsub.unsubscribe).toBeFunction();
    });
  });

  describe("createBunHandler", () => {
    it("should return BunServerHandlers", () => {
      const mockRouter = {
        websocket: {
          open: async () => {},
          close: async () => {},
          message: async () => {},
        },
      } as any;

      const handler = createBunHandler(mockRouter);
      expectTypeOf(handler).toEqualTypeOf<BunServerHandlers>();
    });

    it("should have fetch and websocket properties", () => {
      const mockRouter = {
        websocket: {
          open: async () => {},
          close: async () => {},
          message: async () => {},
        },
      } as any;

      const handler = createBunHandler(mockRouter);

      expectTypeOf(handler.fetch).toBeFunction();
      expectTypeOf(handler.websocket).not.toBeNever();
    });

    it("should have websocket with lifecycle methods", () => {
      const mockRouter = {
        websocket: {
          open: async () => {},
          close: async () => {},
          message: async () => {},
        },
      } as any;

      const handler = createBunHandler(mockRouter);

      // Bun's WebSocketHandler makes lifecycle methods optional at type level,
      // but our implementation always provides them.
      expectTypeOf(handler.websocket).not.toBeNever();
      expectTypeOf(handler.websocket).toHaveProperty("open");
      expectTypeOf(handler.websocket).toHaveProperty("message");
      expectTypeOf(handler.websocket).toHaveProperty("close");
    });

    it("should support generic TContext type", () => {
      interface CustomData extends ConnectionData {
        userId: string;
        role: "admin" | "user";
      }

      const mockRouter = {
        websocket: {
          open: async () => {},
          close: async () => {},
          message: async () => {},
        },
      } as any;

      const handler = createBunHandler<CustomData>(mockRouter);

      // Handler should still be a BunServerHandlers but with typed data
      expectTypeOf(handler).toEqualTypeOf<BunServerHandlers<CustomData>>();
    });
  });

  describe("BunConnectionData", () => {
    it("should have clientId as string", () => {
      expectTypeOf<BunConnectionData>().toHaveProperty("clientId");
    });

    it("should have connectedAt", () => {
      const data: BunConnectionData = {
        clientId: "uuid",
        connectedAt: Date.now(),
      };

      expectTypeOf(data.connectedAt).toBeNumber();
    });

    it("should support custom type parameter", () => {
      interface CustomData extends ConnectionData {
        userId: string;
      }

      const data: BunConnectionData<CustomData> = {
        clientId: "uuid",
        connectedAt: Date.now(),
        userId: "user-123",
      };

      expectTypeOf(data.userId).toBeString();
    });
  });

  describe("BunHandlerOptions", () => {
    it("should have optional authenticate function", () => {
      interface CustomData extends ConnectionData {
        userId: string;
      }

      // Test that authenticate is defined as optional in the interface
      expectTypeOf<BunHandlerOptions<CustomData>>().toHaveProperty(
        "authenticate",
      );

      // When provided, it should be a function that takes Request

      const options: BunHandlerOptions<CustomData> = {
        authenticate: async (_req: Request) => ({
          userId: "user-123",
        }),
      };

      // The property exists on the instance, but its type is optional
      void options; // Used for type checking, not runtime
      expectTypeOf<BunHandlerOptions<CustomData>>().toHaveProperty(
        "authenticate",
      );
    });

    it("should have optional clientIdHeader", () => {
      const options: BunHandlerOptions = {
        clientIdHeader: "x-session-id",
      };

      void options; // Used for type checking, not runtime
      expectTypeOf<BunHandlerOptions["clientIdHeader"]>().toEqualTypeOf<
        string | undefined
      >();
    });
  });
});
