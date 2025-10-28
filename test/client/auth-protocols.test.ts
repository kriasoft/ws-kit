// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Authentication Protocol Tests
 *
 * Tests auth token attachment via query string and WebSocket protocols:
 * - Query mode: token in URL parameter
 * - Protocol mode (append): user protocols + auth protocol
 * - Protocol mode (prepend): auth protocol + user protocols
 * - Protocol deduplication (first occurrence wins)
 * - Token refresh on reconnect
 *
 * See @specs/client.md#protocol-merging
 * See @specs/client.md#auth
 */

import { describe, expect, it } from "bun:test";
import { createClient } from "../../packages/client/src/index";
import { createMockWebSocket } from "./helpers";

describe("Client: Auth - Query Mode", () => {
  it("appends token to URL as query parameter", async () => {
    let capturedUrl: string | URL | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      auth: {
        getToken: () => "test-token-123",
        attach: "query",
        queryParam: "access_token",
      },
      wsFactory: (url, protocols) => {
        capturedUrl = url;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(capturedUrl).toBeDefined();
    const urlStr = capturedUrl!.toString();
    expect(urlStr).toContain("access_token=test-token-123");
  });

  it("uses custom query parameter name", async () => {
    let capturedUrl: string | URL | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      auth: {
        getToken: () => "token-xyz",
        attach: "query",
        queryParam: "token",
      },
      wsFactory: (url) => {
        capturedUrl = url;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    const urlStr = capturedUrl!.toString();
    expect(urlStr).toContain("token=token-xyz");
    expect(urlStr).not.toContain("access_token");
  });

  it("does not modify URL when getToken returns null", async () => {
    let capturedUrl: string | URL | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      auth: {
        getToken: () => null,
        attach: "query",
      },
      wsFactory: (url) => {
        capturedUrl = url;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    const urlStr = capturedUrl!.toString();
    expect(urlStr).toBe("ws://example.com/ws");
  });

  it("refreshes token on reconnect", async () => {
    const tokens = ["token-1", "token-2"];
    let tokenIndex = 0;
    const capturedUrls: string[] = [];

    const client = createClient({
      url: "ws://example.com/ws",
      auth: {
        getToken: () => tokens[tokenIndex++] ?? null,
        attach: "query",
      },
      wsFactory: (url) => {
        capturedUrls.push(url.toString());
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: {
        enabled: true,
        maxAttempts: 2,
        initialDelayMs: 10,
        jitter: "none",
      },
    });

    await client.connect();
    expect(capturedUrls[0]).toContain("access_token=token-1");

    // Simulate disconnect
    await client.close();

    // Reconnect manually
    await client.connect();
    expect(capturedUrls[1]).toContain("access_token=token-2");
  });
});

describe("Client: Auth - Protocol Mode (Append)", () => {
  it("appends auth protocol after user protocols", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: "chat-v2",
      auth: {
        getToken: () => "abc123",
        attach: "protocol",
        protocolPrefix: "bearer.",
        protocolPosition: "append",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(capturedProtocols).toEqual(["chat-v2", "bearer.abc123"]);
  });

  it("appends auth protocol with multiple user protocols", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: ["chat-v2", "notifications-v1"],
      auth: {
        getToken: () => "token",
        attach: "protocol",
        protocolPosition: "append",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(capturedProtocols).toEqual([
      "chat-v2",
      "notifications-v1",
      "bearer.token",
    ]);
  });

  it("uses only auth protocol when no user protocols", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      auth: {
        getToken: () => "token",
        attach: "protocol",
        protocolPosition: "append",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(capturedProtocols).toEqual(["bearer.token"]);
  });
});

describe("Client: Auth - Protocol Mode (Prepend)", () => {
  it("prepends auth protocol before user protocols", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: "chat-v2",
      auth: {
        getToken: () => "abc123",
        attach: "protocol",
        protocolPrefix: "bearer.",
        protocolPosition: "prepend",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(capturedProtocols).toEqual(["bearer.abc123", "chat-v2"]);
  });

  it("prepends with multiple user protocols", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: ["chat-v2", "notifications-v1"],
      auth: {
        getToken: () => "token",
        attach: "protocol",
        protocolPosition: "prepend",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(capturedProtocols).toEqual([
      "bearer.token",
      "chat-v2",
      "notifications-v1",
    ]);
  });
});

describe("Client: Auth - Protocol Deduplication", () => {
  it("removes duplicate protocols (append - user wins)", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: ["bearer.duplicate", "chat-v2"],
      auth: {
        getToken: () => "duplicate",
        attach: "protocol",
        protocolPrefix: "bearer.",
        protocolPosition: "append",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    // First occurrence wins (user protocol)
    expect(capturedProtocols).toEqual(["bearer.duplicate", "chat-v2"]);
    // Should not contain duplicate
    expect(capturedProtocols).toHaveLength(2);
  });

  it("removes duplicate protocols (prepend - auth wins)", async () => {
    let capturedProtocols: string | string[] | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: ["chat-v2", "bearer.duplicate"],
      auth: {
        getToken: () => "duplicate",
        attach: "protocol",
        protocolPrefix: "bearer.",
        protocolPosition: "prepend",
      },
      wsFactory: (url, protocols) => {
        capturedProtocols = protocols;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    // First occurrence wins (auth protocol prepended)
    expect(capturedProtocols).toEqual(["bearer.duplicate", "chat-v2"]);
    expect(capturedProtocols).toHaveLength(2);
  });
});

describe("Client: Auth - Protocol Validation", () => {
  it("throws TypeError for protocolPrefix with spaces", () => {
    expect(() => {
      createClient({
        url: "ws://example.com/ws",
        auth: {
          getToken: () => "token",
          attach: "protocol",
          protocolPrefix: "bearer token.",
        },
      });
    }).toThrow(TypeError);
  });

  it("throws TypeError for protocolPrefix with commas", () => {
    expect(() => {
      createClient({
        url: "ws://example.com/ws",
        auth: {
          getToken: () => "token",
          attach: "protocol",
          protocolPrefix: "bearer,token.",
        },
      });
    }).toThrow(TypeError);
  });

  it("accepts valid protocolPrefix", () => {
    expect(() => {
      createClient({
        url: "ws://example.com/ws",
        auth: {
          getToken: () => "token",
          attach: "protocol",
          protocolPrefix: "auth.",
        },
      });
    }).not.toThrow();
  });
});

describe("Client: Auth - Async Token Provider", () => {
  it("supports async getToken function", async () => {
    let capturedUrl: string | URL | undefined;

    const client = createClient({
      url: "ws://example.com/ws",
      auth: {
        getToken: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "async-token";
        },
        attach: "query",
      },
      wsFactory: (url) => {
        capturedUrl = url;
        const mockWs = createMockWebSocket();
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    const urlStr = capturedUrl!.toString();
    expect(urlStr).toContain("access_token=async-token");
  });
});

describe("Client: Protocol Selection", () => {
  it("exposes selected protocol via client.protocol", async () => {
    const mockWs = createMockWebSocket();

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: ["chat-v2", "chat-v1"],
      wsFactory: () => {
        // Simulate server selecting chat-v2
        mockWs.protocol = "chat-v2";
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    expect(client.protocol).toBe(""); // Not connected yet

    await client.connect();

    expect(client.protocol).toBe("chat-v2");
  });

  it("protocol is empty string when server selects none", async () => {
    const mockWs = createMockWebSocket();

    const client = createClient({
      url: "ws://example.com/ws",
      protocols: "chat-v2",
      wsFactory: () => {
        // Server accepts connection but selects no protocol
        mockWs.protocol = "";
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    await client.connect();

    expect(client.protocol).toBe("");
  });
});
