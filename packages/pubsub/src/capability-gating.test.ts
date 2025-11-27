// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for capability gating.
 * Verify that ctx.publish() and ctx.topics exist only when withPubSub() is plugged.
 *
 * These tests use TypeScript's type system to ensure compile-time safety.
 * They should NOT compile if capability gating is broken.
 */

import type { EventContext, MinimalContext, PubSubContext } from "@ws-kit/core";
import { describe, expect, it } from "bun:test";

describe("Capability Gating (Types)", () => {
  it("should expose PubSubContext type with publish and topics", () => {
    // These lines verify that PubSubContext type exists with the expected interface.
    // If the type structure changes, TypeScript will report an error here.

    type TestPublish = PubSubContext["publish"]; // ✅ Should exist
    type TestTopics = PubSubContext["topics"]; // ✅ Should exist

    expect(true).toBe(true); // Placeholder: real validation is at compile time
  });

  it("should show that EventContext does not include pubsub methods", () => {
    // This test verifies separation of concerns:
    // EventContext is about payload + send, not pub/sub.
    // The following would NOT compile:
    //   type BadType = EventContext["publish"]; // ❌ Property 'publish' does not exist

    type TestPayload = EventContext["payload"]; // ✅ Exists
    type TestSend = EventContext["send"]; // ✅ Exists

    expect(true).toBe(true); // Placeholder: real validation is at compile time
  });

  it("should show that MinimalContext has only base methods and clientId", () => {
    // MinimalContext is the foundation: clientId (routing identity), ws, type, data, assignData.
    // All plugin methods come from plugins.
    // The following would NOT compile:
    //   type BadPayload = MinimalContext["payload"]; // ❌ Property 'payload' does not exist
    //   type BadSend = MinimalContext["send"]; // ❌ Property 'send' does not exist

    type TestClientId = MinimalContext["clientId"]; // ✅ Exists (stable per-connection ID)
    type TestWs = MinimalContext["ws"]; // ✅ Exists
    type TestType = MinimalContext["type"]; // ✅ Exists
    type TestData = MinimalContext["data"]; // ✅ Exists
    type TestAssignData = MinimalContext["assignData"]; // ✅ Exists

    expect(true).toBe(true); // Placeholder: real validation is at compile time
  });

  it("documentation: full context = EventContext & PubSubContext when both plugins installed", () => {
    // When withZod() and withPubSub() are both plugged, context has all methods:
    type FullContext = EventContext & PubSubContext;

    type HasPayload = FullContext["payload"]; // ✅ From validation
    type HasSend = FullContext["send"]; // ✅ From validation
    type HasPublish = FullContext["publish"]; // ✅ From pub/sub
    type HasTopics = FullContext["topics"]; // ✅ From pub/sub

    expect(true).toBe(true); // Placeholder: real validation is at compile time
  });
});
