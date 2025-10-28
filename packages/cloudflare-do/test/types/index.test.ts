// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { PlatformAdapter, PubSub } from "@ws-kit/core";
import { createDurableObjectAdapter } from "../../src/adapter";
import { DurablePubSub } from "../../src/pubsub";
import { createDurableObjectHandler } from "../../src/handler";
import type {
  DurableObjectHandler,
  DurableObjectWebSocketData,
} from "../../src/types";

describe("@ws-kit/cloudflare-do type tests", () => {
  describe("createDurableObjectAdapter", () => {
    it("should return PlatformAdapter type", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter).toMatchTypeOf<PlatformAdapter>();
    });

    it("should have pubsub", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter.pubsub).toMatchTypeOf<PubSub>();
    });

    it("should have destroy method", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter.destroy).toBeFunction();
      expectTypeOf(adapter.destroy).returns.resolves.toBeVoid();
    });

    it("should have getServerWebSocket as undefined", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter.getServerWebSocket).toBeUndefined();
    });
  });

  describe("DurablePubSub", () => {
    it("should implement PubSub interface", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub).toMatchTypeOf<PubSub>();
    });

    it("should have publish method with correct signature", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub.publish).toBeFunction();
      expectTypeOf(pubsub.publish).parameters.toEqualTypeOf<
        [string, unknown]
      >();
      expectTypeOf(pubsub.publish).returns.resolves.toBeVoid();
    });

    it("should have subscribe method", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub.subscribe).toBeFunction();
      expectTypeOf(pubsub.subscribe).parameters.toEqualTypeOf<
        [string, (message: unknown) => void | Promise<void>]
      >();
    });

    it("should have unsubscribe method", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub.unsubscribe).toBeFunction();
    });

    it("should have destroy method", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub.destroy).toBeFunction();
    });
  });

  describe("createDurableObjectHandler", () => {
    it("should return DurableObjectHandler", () => {
      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createDurableObjectHandler({ router: mockRouter });
      expectTypeOf(handler).toMatchTypeOf<DurableObjectHandler>();
    });

    it("should have fetch property", () => {
      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createDurableObjectHandler({ router: mockRouter });
      expectTypeOf(handler.fetch).toBeFunction();
      expectTypeOf(handler.fetch).parameters.toEqualTypeOf<[Request]>();
      expectTypeOf(handler.fetch).returns.resolves.toMatchTypeOf<Response>();
    });

    it("should support generic TData type", () => {
      type CustomData = {
        userId: string;
        role: "admin" | "user";
      };

      const mockRouter = {
        handleOpen: async () => {},
        handleClose: async () => {},
        handleMessage: async () => {},
      } as any;

      const handler = createDurableObjectHandler<CustomData>({
        router: mockRouter,
      });
      expectTypeOf(handler).toMatchTypeOf<DurableObjectHandler<CustomData>>();
    });
  });

  describe("DurableObjectWebSocketData", () => {
    it("should have clientId", () => {
      const data: DurableObjectWebSocketData = {
        clientId: "uuid-123",
      };

      expectTypeOf(data.clientId).toBeString();
    });

    it("should have connectedAt", () => {
      const data: DurableObjectWebSocketData = {
        clientId: "uuid-123",
        connectedAt: Date.now(),
      };

      expectTypeOf(data.connectedAt).toBeNumber();
    });

    it("should have optional resourceId", () => {
      const data: DurableObjectWebSocketData = {
        clientId: "uuid-123",
        connectedAt: Date.now(),
        resourceId: "room:123",
      };

      expectTypeOf(data.resourceId).toBeString();
    });

    it("should support custom type parameter", () => {
      type CustomData = { userId: string };

      const data: DurableObjectWebSocketData<CustomData> = {
        clientId: "uuid-123",
        connectedAt: Date.now(),
        userId: "user-456",
      };

      expectTypeOf(data.userId).toBeString();
    });
  });
});
