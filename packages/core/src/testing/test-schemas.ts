// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Reusable test schemas for all tests.
 * Mirrors what validators (Zod, Valibot) will create.
 */

import type { MessageDescriptor } from "@ws-kit/core";

export const JOIN: MessageDescriptor = {
  type: "JOIN",
  kind: "event",
};

export const MESSAGE: MessageDescriptor = {
  type: "MESSAGE",
  kind: "event",
};

export const GET_USER: MessageDescriptor & { response: MessageDescriptor } = {
  type: "GET_USER",
  kind: "rpc",
  response: { type: "USER", kind: "event" },
};
