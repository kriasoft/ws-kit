/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { CloseHandler, MessageHandlerEntry, OpenHandler } from "./types";

export class WebSocketHandlers<T = any> {
  public readonly open: OpenHandler<T>[] = [];
  public readonly close: CloseHandler<T>[] = [];
  public readonly message = new Map<string, MessageHandlerEntry>();
}
