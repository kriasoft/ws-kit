// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expectTypeOf, it } from "bun:test";
import { createDurableObjectAdapter } from "./adapter.js";
import { createDurableObjectHandler } from "./handler.js";
import { DurablePubSub } from "./pubsub.js";
import type {
  DurableObjectHandler,
  DurableObjectWebSocketData,
} from "./types.js";

describe("@ws-kit/cloudflare type tests", () => {
  describe("createDurableObjectAdapter", () => {
    it("should return object with pubsub and destroy", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter).toEqualTypeOf<{
        pubsub: DurablePubSub;
        destroy(): Promise<void>;
      }>();
    });

    it("should have pubsub property", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter.pubsub).toEqualTypeOf<DurablePubSub>();
    });

    it("should have destroy method", () => {
      const adapter = createDurableObjectAdapter();
      expectTypeOf(adapter.destroy).toBeFunction();
      expectTypeOf(adapter.destroy).returns.resolves.toBeVoid();
    });
  });

  describe("DurablePubSub", () => {
    it("should be a class", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub).toEqualTypeOf<DurablePubSub>();
    });

    it("should have publish method", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub.publish).toBeFunction();
    });

    it("should have subscribe method", () => {
      const pubsub = new DurablePubSub();
      expectTypeOf(pubsub.subscribe).toBeFunction();
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
        websocket: {
          open: async () => {},
          close: async () => {},
          message: async () => {},
        },
      } as any;

      const handler = createDurableObjectHandler(mockRouter);
      expectTypeOf(handler).toExtend<DurableObjectHandler>();
    });

    it("should have fetch property", () => {
      const mockRouter = {
        websocket: {
          open: async () => {},
          close: async () => {},
          message: async () => {},
        },
      } as any;

      const handler = createDurableObjectHandler(mockRouter);
      expectTypeOf(handler.fetch).toBeFunction();
    });
  });

  describe("DurableObjectWebSocketData", () => {
    it("should have connectedAt as required field", () => {
      const data: DurableObjectWebSocketData = {
        connectedAt: Date.now(),
      };

      expectTypeOf(data.connectedAt).toEqualTypeOf<number>();
    });

    it("should have optional resourceId", () => {
      const data: DurableObjectWebSocketData = {
        connectedAt: Date.now(),
        resourceId: "room:123",
      };

      expectTypeOf(data.resourceId).toEqualTypeOf<string | undefined>();
    });

    it("should have optional doId", () => {
      const data: DurableObjectWebSocketData = {
        connectedAt: Date.now(),
        doId: "do-instance-123",
      };

      expectTypeOf(data.doId).toEqualTypeOf<string | undefined>();
    });

    it("should support custom type parameter", () => {
      type CustomData = Record<string, unknown> & {
        userId: string;
      };

      const data: DurableObjectWebSocketData<CustomData> = {
        connectedAt: Date.now(),
        userId: "user-456",
      };

      expectTypeOf(data.userId).toEqualTypeOf<string>();
    });
  });
});
