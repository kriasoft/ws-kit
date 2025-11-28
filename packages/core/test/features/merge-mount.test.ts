// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createDescriptor } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";
import { createRouter } from "../../src/core/createRouter";
import type { MessageDescriptor } from "../../src/protocol/message-descriptor";
import type { ServerWebSocket } from "../../src/ws/platform-adapter";

/**
 * Mock WebSocket for testing.
 */
function createMockWebSocket(): ServerWebSocket {
  return {
    send: () => {},
    close: () => {},
    readyState: "OPEN",
  };
}

describe("merge & mount", () => {
  describe("merge()", () => {
    it("should combine two routers without conflicts", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema1: MessageDescriptor = createDescriptor(
        "AUTH_LOGIN",
        "event",
      );
      const schema2: MessageDescriptor = createDescriptor("CHAT_SEND", "event");

      let auth = false;
      let chat = false;

      router1.on(schema1, () => {
        auth = true;
      });
      router2.on(schema2, () => {
        chat = true;
      });

      router1.merge(router2);

      const ws = createMockWebSocket();

      await router1.websocket.message(
        ws,
        JSON.stringify({ type: "AUTH_LOGIN" }),
      );
      await router1.websocket.message(
        ws,
        JSON.stringify({ type: "CHAT_SEND" }),
      );

      expect(auth).toBe(true);
      expect(chat).toBe(true);
    });

    it("should throw on conflicting types with onConflict='error'", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema: MessageDescriptor = createDescriptor("MSG", "event");

      router1.on(schema, () => {});
      router2.on(schema, () => {});

      let threwError = false;
      try {
        router1.merge(router2, { onConflict: "error" });
      } catch (e) {
        threwError = true;
      }

      expect(threwError).toBe(true);
    });

    it("should skip conflicting types with onConflict='skip'", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema: MessageDescriptor = createDescriptor("MSG", "event");

      let from1 = false;
      let from2 = false;

      router1.on(schema, () => {
        from1 = true;
      });
      router2.on(schema, () => {
        from2 = true;
      });

      router1.merge(router2, { onConflict: "skip" });

      const ws = createMockWebSocket();
      await router1.websocket.message(ws, JSON.stringify({ type: "MSG" }));

      // Should use handler from router1 (skip router2)
      expect(from1).toBe(true);
      expect(from2).toBe(false);
    });

    it("should replace conflicting types with onConflict='replace'", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema: MessageDescriptor = createDescriptor("MSG", "event");

      let from1 = false;
      let from2 = false;

      router1.on(schema, () => {
        from1 = true;
      });
      router2.on(schema, () => {
        from2 = true;
      });

      router1.merge(router2, { onConflict: "replace" });

      const ws = createMockWebSocket();
      await router1.websocket.message(ws, JSON.stringify({ type: "MSG" }));

      // Should use handler from router2 (replaced router1)
      expect(from1).toBe(false);
      expect(from2).toBe(true);
    });

    it("should default to onConflict='error' behavior", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema: MessageDescriptor = createDescriptor("MSG", "event");

      router1.on(schema, () => {});
      router2.on(schema, () => {});

      let threwError = false;
      try {
        router1.merge(router2); // No conflict policy specified
      } catch (e) {
        threwError = true;
      }

      expect(threwError).toBe(true);
    });

    it("should copy handlers from router2 to router1", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema1: MessageDescriptor = createDescriptor("MSG1", "event");
      const schema2: MessageDescriptor = createDescriptor("MSG2", "event");

      let handler1Called = false;
      let handler2Called = false;

      router1.on(schema1, () => {
        handler1Called = true;
      });

      router2.on(schema2, () => {
        handler2Called = true;
      });

      // Merge combines handlers
      router1.merge(router2);

      const ws = createMockWebSocket();

      // router1 should have its own handler
      await router1.websocket.message(ws, JSON.stringify({ type: "MSG1" }));
      expect(handler1Called).toBe(true);

      handler1Called = false;

      // router1 should also have router2's handler after merge
      await router1.websocket.message(ws, JSON.stringify({ type: "MSG2" }));
      expect(handler2Called).toBe(true);
    });

    it("should merge multiple routers in sequence", async () => {
      const main = createRouter();
      const auth = createRouter();
      const chat = createRouter();
      const notifications = createRouter();

      const authSchema: MessageDescriptor = createDescriptor("LOGIN", "event");
      const chatSchema: MessageDescriptor = createDescriptor("SEND", "event");
      const notifySchema: MessageDescriptor = createDescriptor(
        "NOTIFY",
        "event",
      );

      let authCalled = false;
      let chatCalled = false;
      let notifyCalled = false;

      auth.on(authSchema, () => {
        authCalled = true;
      });
      chat.on(chatSchema, () => {
        chatCalled = true;
      });
      notifications.on(notifySchema, () => {
        notifyCalled = true;
      });

      main.merge(auth).merge(chat).merge(notifications);

      const ws = createMockWebSocket();

      await main.websocket.message(ws, JSON.stringify({ type: "LOGIN" }));
      await main.websocket.message(ws, JSON.stringify({ type: "SEND" }));
      await main.websocket.message(ws, JSON.stringify({ type: "NOTIFY" }));

      expect(authCalled).toBe(true);
      expect(chatCalled).toBe(true);
      expect(notifyCalled).toBe(true);
    });
  });

  describe("mount()", () => {
    it("should prefix all types in mounted router", async () => {
      const main = createRouter();
      const auth = createRouter();

      const schema: MessageDescriptor = createDescriptor("LOGIN", "event");

      let called = false;
      auth.on(schema, () => {
        called = true;
      });

      main.mount("auth.", auth);

      const ws = createMockWebSocket();

      // Should not match unprefixed type
      await main.websocket.message(ws, JSON.stringify({ type: "LOGIN" }));
      expect(called).toBe(false);

      // Should match prefixed type
      await main.websocket.message(ws, JSON.stringify({ type: "auth.LOGIN" }));
      expect(called).toBe(true);
    });

    it("should support multiple nested mounts", async () => {
      const main = createRouter();
      const api = createRouter();
      const auth = createRouter();

      const schema: MessageDescriptor = createDescriptor("LOGIN", "event");

      let called = false;
      auth.on(schema, () => {
        called = true;
      });

      api.mount("auth.", auth);
      main.mount("api.", api);

      const ws = createMockWebSocket();

      await main.websocket.message(
        ws,
        JSON.stringify({ type: "api.auth.LOGIN" }),
      );
      expect(called).toBe(true);
    });

    it("should be namespace-safe (always avoid collisions)", async () => {
      const main = createRouter();
      const users = createRouter();
      const posts = createRouter();

      const userSchema: MessageDescriptor = createDescriptor("GET", "event");
      const postSchema: MessageDescriptor = createDescriptor("GET", "event");

      let userCalled = false;
      let postCalled = false;

      users.on(userSchema, () => {
        userCalled = true;
      });
      posts.on(postSchema, () => {
        postCalled = true;
      });

      main.mount("users.", users);
      main.mount("posts.", posts);

      const ws = createMockWebSocket();

      await main.websocket.message(ws, JSON.stringify({ type: "users.GET" }));
      expect(userCalled).toBe(true);
      expect(postCalled).toBe(false);

      userCalled = false;
      postCalled = false;

      await main.websocket.message(ws, JSON.stringify({ type: "posts.GET" }));
      expect(userCalled).toBe(false);
      expect(postCalled).toBe(true);
    });

    it("should support conflict resolution with mount", async () => {
      const main = createRouter();
      const auth1 = createRouter();
      const auth2 = createRouter();

      const schema: MessageDescriptor = createDescriptor("LOGIN", "event");

      let from1 = false;
      let from2 = false;

      auth1.on(schema, () => {
        from1 = true;
      });
      auth2.on(schema, () => {
        from2 = true;
      });

      main.mount("auth.", auth1);

      let threwError = false;
      try {
        main.mount("auth.", auth2, { onConflict: "error" });
      } catch (e) {
        threwError = true;
      }

      expect(threwError).toBe(true);
    });

    it("should allow skip/replace conflict resolution on mount", async () => {
      const main = createRouter();
      const v1 = createRouter();
      const v2 = createRouter();

      const schema: MessageDescriptor = createDescriptor("LOGIN", "event");

      let from1 = false;
      let from2 = false;

      v1.on(schema, () => {
        from1 = true;
      });
      v2.on(schema, () => {
        from2 = true;
      });

      main.mount("auth.", v1);
      main.mount("auth.", v2, { onConflict: "skip" });

      const ws = createMockWebSocket();
      await main.websocket.message(ws, JSON.stringify({ type: "auth.LOGIN" }));

      expect(from1).toBe(true);
      expect(from2).toBe(false);
    });

    it("should chain mount calls", async () => {
      const main = createRouter();
      const auth = createRouter();
      const chat = createRouter();

      const authSchema: MessageDescriptor = createDescriptor("LOGIN", "event");
      const chatSchema: MessageDescriptor = createDescriptor("SEND", "event");

      let authCalled = false;
      let chatCalled = false;

      auth.on(authSchema, () => {
        authCalled = true;
      });
      chat.on(chatSchema, () => {
        chatCalled = true;
      });

      main.mount("auth.", auth).mount("chat.", chat);

      const ws = createMockWebSocket();

      await main.websocket.message(ws, JSON.stringify({ type: "auth.LOGIN" }));
      await main.websocket.message(ws, JSON.stringify({ type: "chat.SEND" }));

      expect(authCalled).toBe(true);
      expect(chatCalled).toBe(true);
    });

    it("should handle empty prefix gracefully", async () => {
      const main = createRouter();
      const sub = createRouter();

      const schema: MessageDescriptor = createDescriptor("MSG", "event");

      let called = false;
      sub.on(schema, () => {
        called = true;
      });

      main.mount("", sub);

      const ws = createMockWebSocket();
      await main.websocket.message(ws, JSON.stringify({ type: "MSG" }));

      expect(called).toBe(true);
    });
  });

  describe("merge vs mount", () => {
    it("should combine routers directly without prefix", async () => {
      const main = createRouter();
      const module = createRouter();

      const schema: MessageDescriptor = createDescriptor("ACTION", "event");

      let called = false;
      module.on(schema, () => {
        called = true;
      });

      main.merge(module);

      const ws = createMockWebSocket();
      await main.websocket.message(ws, JSON.stringify({ type: "ACTION" }));

      expect(called).toBe(true);
    });

    it("should prefix types with mount but not with merge", async () => {
      const merge = createRouter();
      const mounted = createRouter();
      const module = createRouter();

      const schema: MessageDescriptor = createDescriptor("ACTION", "event");

      let mergeCalled = false;
      let mountCalled = false;

      const handler1 = () => {
        mergeCalled = true;
      };
      const handler2 = () => {
        mountCalled = true;
      };

      module.on(schema, handler1);
      const moduleForMount = createRouter();
      moduleForMount.on(schema, handler2);

      merge.merge(module);
      mounted.mount("mod.", moduleForMount);

      const ws = createMockWebSocket();

      // Merge: type unchanged
      await merge.websocket.message(ws, JSON.stringify({ type: "ACTION" }));
      expect(mergeCalled).toBe(true);
      expect(mountCalled).toBe(false);

      mergeCalled = false;
      mountCalled = false;

      // Mount: type is prefixed
      await mounted.websocket.message(
        ws,
        JSON.stringify({ type: "mod.ACTION" }),
      );
      expect(mergeCalled).toBe(false);
      expect(mountCalled).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should merge routers with handlers registered via route()", async () => {
      const main = createRouter();
      const sub = createRouter();

      const schema: MessageDescriptor = createDescriptor("MSG", "event");

      let handlerCalled = false;

      // Register handler via route() builder
      sub.route(schema).on(() => {
        handlerCalled = true;
      });

      main.merge(sub);

      const ws = createMockWebSocket();
      await main.websocket.message(ws, JSON.stringify({ type: "MSG" }));

      // Handler registered via route() should be merged
      expect(handlerCalled).toBe(true);
    });

    it("should copy handlers from merged router into main router", async () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const schema1: MessageDescriptor = createDescriptor("MSG1", "event");
      const schema2: MessageDescriptor = createDescriptor("MSG2", "event");

      let router1Called = false;
      let handler2Called = false;

      router1.on(schema1, () => {
        router1Called = true;
      });
      router2.on(schema2, () => {
        handler2Called = true;
      });

      // Merge router2 into router1 (no conflicts)
      router1.merge(router2);

      const ws = createMockWebSocket();

      // router2 should still work independently
      await router2.websocket.message(ws, JSON.stringify({ type: "MSG2" }));
      expect(handler2Called).toBe(true);

      router1Called = false;
      handler2Called = false;

      // router1 should have handler1
      await router1.websocket.message(ws, JSON.stringify({ type: "MSG1" }));
      expect(router1Called).toBe(true);
      expect(handler2Called).toBe(false);

      router1Called = false;

      // After merge, router1 should also have handler2
      await router1.websocket.message(ws, JSON.stringify({ type: "MSG2" }));
      expect(router1Called).toBe(false);
      expect(handler2Called).toBe(true);
    });
  });
});
