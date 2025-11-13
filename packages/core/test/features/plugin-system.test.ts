// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { createRouter } from "../../src/core/createRouter";
import { RouterImpl } from "../../src/core/router";

describe("Plugin System", () => {
  it("should apply a plugin and return the router", () => {
    const router = createRouter();
    let pluginCalled = false;

    const testPlugin = (r: any) => {
      pluginCalled = true;
      return r;
    };

    const result = router.plugin(testPlugin);

    expect(pluginCalled).toBe(true);
    expect(result).toBe(router); // Same instance returned
  });

  it("should enforce plugin idempotency (same plugin applied twice is a no-op)", () => {
    const router = createRouter() as unknown as RouterImpl;
    let callCount = 0;

    const idempotentPlugin = (r: any) => {
      callCount++;
      return r;
    };

    router.plugin(idempotentPlugin);
    expect(callCount).toBe(1);

    router.plugin(idempotentPlugin);
    expect(callCount).toBe(1); // Should still be 1, plugin not called again
  });

  it("should track capabilities added by plugins", () => {
    const router = createRouter() as unknown as RouterImpl;

    const pluginA = (r: any) => {
      (r as any).__caps = { validation: true };
      return r;
    };

    const pluginB = (r: any) => {
      (r as any).__caps = { pubsub: true };
      return r;
    };

    router.plugin(pluginA);
    let caps = router.getCapabilities();
    expect(caps.validation).toBe(true);
    expect(caps.pubsub).toBeUndefined();

    router.plugin(pluginB);
    caps = router.getCapabilities();
    expect(caps.validation).toBe(true);
    expect(caps.pubsub).toBe(true);
  });

  it("should support fluent plugin chaining", () => {
    const pluginA = (r: any) => {
      (r as any).__caps = { validation: true };
      return r;
    };

    const pluginB = (r: any) => {
      (r as any).__caps = { pubsub: true };
      return r;
    };

    const pluginC = (r: any) => {
      (r as any).__caps = { telemetry: true };
      return r;
    };

    const router = createRouter()
      .plugin(pluginA)
      .plugin(pluginB)
      .plugin(pluginC) as unknown as RouterImpl;

    const caps = router.getCapabilities();
    expect(caps.validation).toBe(true);
    expect(caps.pubsub).toBe(true);
    expect(caps.telemetry).toBe(true);
  });

  it("should allow plugins to extend router with new methods", () => {
    const router = createRouter();

    const plugin = (r: any) => {
      const customMethod = () => "custom-result";
      const enhanced = Object.assign(r, { customMethod });
      (enhanced as any).__caps = { custom: true };
      return enhanced;
    };

    const result = router.plugin(plugin);
    expect((result as any).customMethod()).toBe("custom-result");
  });

  it("should handle plugins that return different instances", () => {
    const router = createRouter();

    const plugin = (r: any) => {
      // This plugin returns a new instance (not ideal but should work)
      const newRouter = { ...r, custom: true };
      (newRouter as any).__caps = { custom: true };
      return newRouter;
    };

    const result = router.plugin(plugin);
    expect((result as any).custom).toBe(true);
  });

  it("should prevent idempotent plugins from being reapplied", () => {
    const router = createRouter() as unknown as RouterImpl;
    const callLog: string[] = [];

    const plugin = (r: any) => {
      callLog.push("plugin-called");
      return r;
    };

    // Apply multiple times
    router.plugin(plugin);
    router.plugin(plugin);
    router.plugin(plugin);

    expect(callLog.length).toBe(1);
  });
});
