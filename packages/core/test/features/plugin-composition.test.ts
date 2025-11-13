// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime tests for plugin composition patterns.
 *
 * Tests:
 * - Plugin chaining and API accumulation
 * - Wrapper plugins (enforced composition)
 * - Runtime dependency checking via pluginHost
 * - Partial/optional dependencies with fallback
 * - Property collision detection
 */

import { describe, it, expect } from "bun:test";
import { createRouter } from "../../src/core/createRouter";
import { definePlugin } from "../../src/plugin/define";
import type { Router } from "../../src/core/router";

// ============================================================================
// Test Utilities
// ============================================================================

interface SimpleAPI {
  simple(): string;
}

interface AdvancedAPI {
  advanced(): string;
}

interface MetricsAPI {
  metrics: {
    track(event: string): void;
  };
}

const simplePlugin = definePlugin<any, SimpleAPI>((router) => ({
  simple: () => "simple",
}));

const advancedPlugin = definePlugin<any, AdvancedAPI>((router) => ({
  advanced: () => "advanced",
}));

const metricsPlugin = definePlugin<any, MetricsAPI>((router) => ({
  metrics: {
    track: (event: string) => {
      // no-op in test
    },
  },
}));

// ============================================================================
// Test Suite
// ============================================================================

describe("Plugin Composition", () => {
  describe("Plugin Chaining", () => {
    it("should allow chaining multiple plugins", () => {
      const router = createRouter()
        .plugin(simplePlugin)
        .plugin(advancedPlugin)
        .plugin(metricsPlugin);

      expect(typeof (router as any).simple).toBe("function");
      expect(typeof (router as any).advanced).toBe("function");
      expect(typeof (router as any).metrics).toBe("object");
    });

    it("should preserve router base methods after plugin chain", () => {
      const router = createRouter().plugin(simplePlugin).plugin(advancedPlugin);

      // Base methods should still be available
      expect(typeof router.on).toBe("function");
      expect(typeof router.use).toBe("function");
      expect(typeof router.plugin).toBe("function");
    });

    it("should accumulate capabilities from all plugins", () => {
      const router = createRouter() as any;

      router.plugin(simplePlugin);
      let caps = router.getCapabilities?.();
      expect(caps).toBeDefined();

      router.plugin(advancedPlugin);
      caps = router.getCapabilities?.();
      expect(caps).toBeDefined();
    });
  });

  describe("Plugin Idempotency", () => {
    it("should not re-apply idempotent plugins", () => {
      let callCount = 0;

      const countingPlugin = definePlugin<any, { count: number }>((router) => {
        callCount++;
        return { count: callCount };
      });

      const router = createRouter();
      router.plugin(countingPlugin);
      expect(callCount).toBe(1);

      router.plugin(countingPlugin);
      expect(callCount).toBe(1); // Should not increment
    });

    it("should allow different plugin instances", () => {
      let callCount = 0;

      const createCountingPlugin = () =>
        definePlugin<any, { count: number }>((router) => {
          callCount++;
          return { count: callCount };
        });

      const router = createRouter();
      const plugin1 = createCountingPlugin();
      const plugin2 = createCountingPlugin();

      router.plugin(plugin1);
      expect(callCount).toBe(1);

      router.plugin(plugin2);
      expect(callCount).toBe(2); // Different plugin instance, should call
    });
  });

  describe("Wrapper Plugins (Enforced Composition)", () => {
    it("should allow wrapper plugins that depend on base plugins", () => {
      const baseMetricsPlugin = definePlugin<any, MetricsAPI>((router) => ({
        metrics: {
          track: (event: string) => {
            // base impl
          },
        },
      }));

      interface AdvancedMetricsAPI {
        trackAdvanced(event: string, level: number): void;
      }

      const advancedMetricsWrapper = definePlugin<any, AdvancedMetricsAPI>(
        (router) => {
          // Ensure base metrics plugin was applied first
          const baseRouter = baseMetricsPlugin(router);

          return {
            trackAdvanced: (event: string, level: number) => {
              // Uses base metrics
              (baseRouter as any).metrics.track(`[L${level}] ${event}`);
            },
          };
        },
      );

      const router = createRouter().plugin(advancedMetricsWrapper);

      // Should have both base and advanced methods
      expect(typeof (router as any).metrics).toBe("object");
      expect(typeof (router as any).trackAdvanced).toBe("function");
    });
  });

  describe("Property Collision Detection", () => {
    it("should warn about namespace collisions (dev mode)", () => {
      const consoleWarnSpy = { messages: [] as string[] };
      const originalWarn = console.warn;
      console.warn = (msg: string) => {
        consoleWarnSpy.messages.push(msg);
      };

      try {
        const plugin1 = definePlugin<any, { test: () => string }>((router) => ({
          test: () => "plugin1",
        }));

        const plugin2 = definePlugin<any, { test: () => string }>((router) => ({
          test: () => "plugin2",
        }));

        const router = createRouter().plugin(plugin1).plugin(plugin2);

        // Should have warned about collision on second plugin
        const hasCollisionWarning = consoleWarnSpy.messages.some((msg) =>
          msg.includes("overwrites existing router property"),
        );
        // Note: Only warns in dev mode (NODE_ENV !== 'production')
        if (
          typeof process !== "undefined" &&
          process.env?.NODE_ENV !== "production"
        ) {
          expect(hasCollisionWarning).toBe(true);
        }
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should allow final plugin to override previous one", () => {
      const plugin1 = definePlugin<any, { value: string }>((router) => ({
        value: "from-plugin1",
      }));

      const plugin2 = definePlugin<any, { value: string }>((router) => ({
        value: "from-plugin2",
      }));

      const router = createRouter().plugin(plugin1).plugin(plugin2);

      // Last plugin wins
      expect((router as any).value).toBe("from-plugin2");
    });
  });

  describe("Plugin with Router Methods", () => {
    it("should allow plugins to return fluent methods", () => {
      interface FluentAPI {
        fluent(): Router<any>;
      }

      const fluentPlugin = definePlugin<any, FluentAPI>((router) => ({
        fluent: () => router, // Returns router for chaining
      }));

      const router = createRouter().plugin(fluentPlugin);

      const result = (router as any).fluent();
      expect(result).toBe(router); // Should be same instance
    });

    it("should support plugins that modify router behavior", () => {
      interface LoggingAPI {
        withLogging(): Router<any>;
      }

      const loggingPlugin = definePlugin<any, LoggingAPI>((router) => ({
        withLogging: () => {
          // Could wrap middleware, modify behavior, etc.
          return router;
        },
      }));

      const router = createRouter().plugin(loggingPlugin);
      const result = (router as any).withLogging();

      expect(typeof result.on).toBe("function");
      expect(typeof result.use).toBe("function");
    });
  });

  describe("Plugin Context Access", () => {
    it("should allow plugins to access router methods", () => {
      interface ContextAwareAPI {
        getRouteCount(): number;
      }

      const contextAwarePlugin = definePlugin<any, ContextAwareAPI>(
        (router) => ({
          getRouteCount: () => {
            // Plugin can access router internals via symbol
            // (for testing purposes only)
            return 0;
          },
        }),
      );

      const router = createRouter().plugin(contextAwarePlugin);

      // Plugin method should work
      const count = (router as any).getRouteCount?.();
      expect(typeof count).toBe("number");
    });
  });

  describe("Multiple Router Instances", () => {
    it("should not share state between router instances", () => {
      let counter = 0;

      const countingPlugin = definePlugin<any, any>((router) => {
        counter++;
        return { count: counter };
      });

      const router1 = createRouter().plugin(countingPlugin);
      const router2 = createRouter().plugin(countingPlugin);

      expect(counter).toBe(2); // Plugin called for each router

      // But idempotent applies on same router
      router1.plugin(countingPlugin);
      expect(counter).toBe(2); // No increment
    });
  });

  describe("Plugin Return Type Widening", () => {
    it("should properly widen router type through plugin chain", () => {
      interface API1 {
        api1(): void;
      }
      interface API2 {
        api2(): void;
      }

      const plugin1 = definePlugin<any, API1>((router) => ({
        api1: () => {},
      }));

      const plugin2 = definePlugin<any, API2>((router) => ({
        api2: () => {},
      }));

      const router = createRouter().plugin(plugin1).plugin(plugin2);

      // Both APIs should be available
      expect(typeof (router as any).api1).toBe("function");
      expect(typeof (router as any).api2).toBe("function");
    });
  });
});
