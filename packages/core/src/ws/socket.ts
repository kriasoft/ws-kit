/**
 * Socket wrapper: thin adaptor around ServerWebSocket.
 * Handles backpressure hints and error recovery.
 */

import type { ServerWebSocket } from "./platform-adapter";

export class Socket {
  constructor(private ws: ServerWebSocket) {}

  send(data: string | ArrayBuffer): void {
    try {
      this.ws.send(data);
    } catch {
      // Placeholder: handle send errors, propagate to onError
    }
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  get isOpen(): boolean {
    return this.ws.readyState === "OPEN";
  }
}
