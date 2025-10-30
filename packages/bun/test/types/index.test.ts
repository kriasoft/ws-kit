// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { PlatformAdapter, PubSub, ServerWebSocket } from "@ws-kit/core";
import {
  createBunAdapter,
  createBunAdapterWithServer,
} from "../../src/adapter.js";
import { BunPubSub } from "../../src/pubsub.js";
import { createBunHandler } from "../../src/handler.js";
import type {
  BunHandler,
  BunHandlerOptions,
  BunWebSocketData,
} from "../../src/types.js";

describe("@ws-kit/bun type tests", () => {
  describe("createBunAdapter", () => {
    it("should return PlatformAdapter type", () => {
      const adapter = createBunAdapter();
      expectTypeOf(adapter).toMatchTypeOf<PlatformAdapter>();
    });

    it("should have pubsub as optional", () => {
      const adapter = createBunAdapter();
      expectTypeOf(adapter.pubsub).toEqualTypeOf<PubSub | undefined>();
    });

    it("should have getServerWebSocket as optional", () => {
      const adapter = createBunAdapter();
      expectTypeOf(adapter.getServerWebSocket).toEqualTypeOf<
        ((ws: unknown) => ServerWebSocket) | undefined
      >();
    });
  });

  describe("createBunAdapterWithServer", () => {
    it("should return PlatformAdapter with pubsub", () => {
      const mockServer = { publish: () => {} } as any;
      const adapter = createBunAdapterWithServer(mockServer);

      expectTypeOf(adapter).toMatchTypeOf<PlatformAdapter>();
      expectTypeOf(adapter.pubsub).toMatchTypeOf<PubSub>();
    });
  });

  describe("BunPubSub", () => {
    it("should implement PubSub interface", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = new BunPubSub(mockServer);

      expectTypeOf(pubsub).toMatchTypeOf<PubSub>();
    });

    it("should have publish method with correct signature", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = new BunPubSub(mockServer);

      expectTypeOf(pubsub.publish).toBeFunction();
      expectTypeOf(pubsub.publish).parameters.toEqualTypeOf<
        [string, unknown]
      >();
      expectTypeOf(pubsub.publish).returns.resolves.toBeVoid();
    });

    it("should have subscribe method", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = new BunPubSub(mockServer);

      expectTypeOf(pubsub.subscribe).toBeFunction();
    });

    it("should have unsubscribe method", () => {
      const mockServer = { publish: () => {} } as any;
      const pubsub = new BunPubSub(mockServer);

      expectTypeOf(pubsub.unsubscribe).toBeFunction();
    });
  });

  describe("createBunHandler", () => {
    it("should return BunHandler", () => {
      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createBunHandler(mockRouter);
      expectTypeOf(handler).toMatchTypeOf<BunHandler>();
    });

    it("should have fetch and websocket properties", () => {
      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createBunHandler(mockRouter);

      expectTypeOf(handler.fetch).toBeFunction();
      expectTypeOf(handler.websocket).not.toBeNever();
    });

    it("should have websocket with lifecycle methods", () => {
      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createBunHandler(mockRouter);

      expectTypeOf(handler.websocket.open).toBeFunction();
      expectTypeOf(handler.websocket.message).toBeFunction();
      expectTypeOf(handler.websocket.close).toBeFunction();
    });

    it("should support generic TData type", () => {
      interface CustomData {
        userId: string;
        role: "admin" | "user";
      }

      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createBunHandler<CustomData>(mockRouter);

      // Handler should still be a BunHandler but with typed data
      expectTypeOf(handler).toMatchTypeOf<BunHandler<CustomData>>();
    });
  });

  describe("BunWebSocketData", () => {
    it("should have clientId", () => {
      const data: BunWebSocketData = {
        clientId: "uuid",
        connectedAt: Date.now(),
      };

      expectTypeOf(data.clientId).toBeString();
    });

    it("should have connectedAt", () => {
      const data: BunWebSocketData = {
        clientId: "uuid",
        connectedAt: Date.now(),
      };

      expectTypeOf(data.connectedAt).toBeNumber();
    });

    it("should support custom type parameter", () => {
      interface CustomData {
        userId: string;
      }

      const data: BunWebSocketData<CustomData> = {
        clientId: "uuid",
        connectedAt: Date.now(),
        userId: "user-123",
      };

      expectTypeOf(data.userId).toBeString();
    });
  });

  describe("BunHandlerOptions", () => {
    it("should be optional", () => {
      const options: BunHandlerOptions | undefined = undefined;
      expectTypeOf(options).toEqualTypeOf<BunHandlerOptions | undefined>();
    });

    it("should have authenticate function", () => {
      interface CustomData {
        userId: string;
      }

      const options: BunHandlerOptions<CustomData> = {
        authenticate: async (req: Request) => ({
          userId: "user-123",
        }),
      };

      expectTypeOf(options.authenticate).toBeFunction();
      expectTypeOf(options.authenticate).parameters.toEqualTypeOf<[Request]>();
    });

    it("should have clientIdHeader", () => {
      const options: BunHandlerOptions = {
        clientIdHeader: "x-session-id",
      };

      expectTypeOf(options.clientIdHeader).toBeString();
    });
  });
});
