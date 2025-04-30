/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { CloseHandler, MessageHandlerEntry, OpenHandler } from "./types";

export class WebSocketHandlers<Data = unknown> {
  public readonly open: OpenHandler<Data>[] = [];
  public readonly close: CloseHandler<Data>[] = [];
  public readonly message = new Map<string, MessageHandlerEntry<Data>>();
}
