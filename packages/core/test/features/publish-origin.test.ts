// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Publish Sender Tracking Tests
 *
 * Validates sender/author tracking in broadcast messages using recommended patterns:
 * 1. Include sender in payload (recommended for essential message semantics)
 * 2. Include sender in extended meta (recommended for optional metadata)
 *
 * Tests the public API of router.publish() and ctx.publish()
 *
 * Spec: docs/specs/pubsub.md#origin-tracking-include-sender-identity
 * Related: ADR-022 (pub/sub API design), ADR-019 (ctx.publish), ADR-018 (publish terminology)
 */

import { memoryPubSub } from "@ws-kit/memory";
import * as zodModule from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";
import type { RouterImpl } from "../../src/internal";
import { RouterImpl as RouterImplClass } from "../../src/core/router.js";

const { z, message } = zodModule;

describe("Publish Sender Tracking (router.publish API)", () => {
  describe("Sender in Payload Pattern", () => {
    it("should support including sender userId in payload", async () => {
      const ChatMessage = message("CHAT", {
        text: z.string(),
        senderId: z.string(),
      });

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "CHAT",
          safeParse: (schema: any, data: any) => ({
            success: true,
            data,
          }),
        } as any,
      });

      // Verify router.publish() returns PublishResult
      const result = await router.publish("room:general", ChatMessage, {
        text: "Hello world",
        senderId: "alice",
      });

      expect(result.ok).toBe(true);
      expect(result.ok === true && result.capability).toBeDefined();
    });

    it("should accept numeric sender IDs in payload", async () => {
      const RoomUpdate = message("ROOM_UPDATE", {
        text: z.string(),
        userId: z.number(),
      });

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "ROOM_UPDATE",
          safeParse: (schema: any, data: any) => ({
            success: true,
            data,
          }),
        } as any,
      });

      const result = await router.publish("room:123", RoomUpdate, {
        text: "User joined",
        userId: 42,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("Sender in Extended Meta Pattern", () => {
    it("should support custom meta fields via PublishOptions", async () => {
      const Message = message(
        "MSG",
        { text: z.string() },
        { senderId: z.string().optional() },
      );

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "MSG",
          safeParse: (schema: any, data: any) => ({
            success: true,
            data,
          }),
        } as any,
      });

      // Use meta option to include sender in extended metadata
      const result = await router.publish(
        "room:general",
        Message,
        { text: "Hello" },
        { meta: { senderId: "bob" } },
      );

      expect(result.ok).toBe(true);
    });

    it("should merge multiple custom meta fields", async () => {
      const RoomMsg = message(
        "ROOM",
        { text: z.string() },
        {
          roomId: z.string(),
          senderId: z.string().optional(),
          priority: z.number().optional(),
        },
      );

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "ROOM",
          safeParse: (schema: any, data: any) => ({
            success: true,
            data,
          }),
        } as any,
      });

      const result = await router.publish(
        "room:lobby",
        RoomMsg,
        { text: "Welcome" },
        {
          meta: {
            roomId: "room:123",
            senderId: "charlie",
            priority: 5,
          },
        },
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("Timestamp Auto-Injection", () => {
    it("should auto-inject timestamp in metadata", async () => {
      const Message = message("MSG", { text: z.string() });
      let capturedMessage: any;

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "MSG",
          safeParse: (schema: any, data: any) => {
            capturedMessage = data;
            return { success: true, data };
          },
        } as any,
      });

      await router.publish("room", Message, { text: "test" });

      // Verify timestamp was auto-injected
      expect(capturedMessage.meta).toBeDefined();
      expect(typeof capturedMessage.meta.timestamp).toBe("number");
      expect(capturedMessage.meta.timestamp).toBeGreaterThan(0);
    });

    it("should preserve user-provided timestamp", async () => {
      const Message = message("MSG", { text: z.string() });
      let capturedMessage: any;

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "MSG",
          safeParse: (schema: any, data: any) => {
            capturedMessage = data;
            return { success: true, data };
          },
        } as any,
      });

      const customTimestamp = 1234567890;
      await router.publish(
        "room",
        Message,
        { text: "test" },
        {
          meta: { timestamp: customTimestamp },
        },
      );

      expect(capturedMessage.meta.timestamp).toBe(customTimestamp);
    });
  });

  describe("Validation and Error Handling", () => {
    it("should return 0 on validation failure", async () => {
      const Message = message("MSG", { text: z.string() });

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "MSG",
          safeParse: (schema: any, data: any) => ({
            success: false,
            error: "Validation error",
          }),
        } as any,
      });

      const result = await router.publish("room", Message, {
        text: "test",
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe("VALIDATION");
      expect(result.ok === false && result.retryable).toBe(false);
    });

    it("should handle missing validator gracefully", async () => {
      const Message = message("MSG", { text: z.string() });

      const router = new RouterImplClass({
        validator: undefined as any,
      });

      const result = await router.publish("room", Message, {
        text: "test",
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe("STATE");
      expect(result.ok === false && result.retryable).toBe(false);
      expect(result.ok === false && result.cause).toBeInstanceOf(Error);
    });
  });

  describe("MemoryPubSub Integration", () => {
    it("should work with real MemoryPubSub", async () => {
      const Message = message("MSG", { text: z.string() });

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) =>
            schema?.type?.value || schema?.type || "MSG",
          safeParse: (schema: any, data: any) => ({
            success: true,
            data,
          }),
        } as any,
        pubsub: memoryPubSub(),
      });

      // Subscribe to channel first
      let receivedMessage: any;
      router.pubsub.subscribe("room", (msg) => {
        receivedMessage = msg;
      });

      // Publish message
      const result = await router.publish(
        "room",
        Message,
        { text: "Hello" },
        { meta: { senderId: "alice" } },
      );

      expect(result.ok).toBe(true);

      // Verify message was delivered with sender in extended meta
      expect(receivedMessage).toBeDefined();
      expect(receivedMessage.payload).toEqual({ text: "Hello" });
      expect(receivedMessage.meta.senderId).toBe("alice");
      expect(receivedMessage.meta.timestamp).toBeDefined();
    });

    it("should not expose clientId in meta", async () => {
      const Message = message("MSG", { text: z.string() });

      const router = new RouterImplClass({
        validator: {
          getMessageType: (schema: any) => schema.type || "MSG",
          safeParse: (schema: any, data: any) => ({
            success: true,
            data,
          }),
        } as any,
        pubsub: memoryPubSub(),
      });

      let receivedMessage: any;
      router.pubsub.subscribe("room", (msg) => {
        receivedMessage = msg;
      });

      await router.publish("room", Message, { text: "test" });

      // clientId should never be in broadcast metadata
      expect(receivedMessage.meta).not.toHaveProperty("clientId");
    });
  });
});
