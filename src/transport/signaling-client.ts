// ClawChat — Signaling Client (WebSocket)
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.ts";
import type {
  SignalingClientConfig,
  SignalingClientState,
  SignalingEvent,
  SignalingEventType,
} from "./types.ts";

const MODULE = "signaling";

const DEFAULT_CONFIG: SignalingClientConfig = {
  serverUrl: "",
  reconnectAttempts: 10,
  reconnectDelayMs: 2000,
  heartbeatIntervalMs: 30_000,
};

export class SignalingClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: SignalingClientConfig;
  private state: SignalingClientState = "disconnected";
  private reconnectCount = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<SignalingClientConfig> & { serverUrl: string }) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Connection Lifecycle ────────────────────────────────────

  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.state = "connecting";
    this.emit("state", "connecting");

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.config.serverUrl);
        this.ws = ws;

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error(`Connection timeout: ${this.config.serverUrl}`));
        }, 10_000);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.state = "connected";
          this.reconnectCount = 0;
          this.emit("state", "connected");
          this.startHeartbeat();
          resolve();
        };

        ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data as string);
        };

        ws.onclose = (event: CloseEvent) => {
          clearTimeout(timeout);
          this.handleDisconnect(event.reason ?? "Connection closed");
        };

        ws.onerror = (event: Event) => {
          clearTimeout(timeout);
          const err = new Error(`WebSocket error: ${event.type}`);
          this.emit("error", err);
          if (this.state === "connecting") {
            reject(err);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.clearReconnect();

    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }

    this.state = "disconnected";
    this.emit("state", "disconnected");
  }

  // ─── Send Messages ───────────────────────────────────────────

  send(type: string, payload: Record<string, unknown> = {}): void {
    if (this.state !== "connected" || !this.ws) {
      logger.warn(MODULE, `Cannot send '${type}': not connected`);
      return;
    }

    const message = JSON.stringify({ type, ...payload });
    this.ws.send(message);
  }

  sendConnect(peerId: string, metadata: Record<string, unknown>): void {
    this.send("connect", { peerId, metadata });
  }

  sendHeartbeat(peerId: string): void {
    this.send("heartbeat", { peerId });
  }

  sendSDP(from: string, to: string, sdp: RTCSessionDescriptionInit): void {
    this.send("sdp", { from, to, sdp });
  }

  sendICE(from: string, to: string, candidate: RTCIceCandidateInit): void {
    this.send("ice", { from, to, candidate });
  }

  createRoom(peerId: string, roomType: "pair" | "group" = "pair"): void {
    this.send("room:create", { peerId, roomType });
  }

  joinRoom(peerId: string, roomId: string): void {
    this.send("room:join", { peerId, roomId });
  }

  redeemInvite(peerId: string, inviteCode: string): void {
    this.send("invite:redeem", { peerId, inviteCode });
  }

  // ─── State ───────────────────────────────────────────────────

  getState(): SignalingClientState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  // ─── Message Handling ────────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logger.error(MODULE, `Invalid JSON from signaling server: ${raw.slice(0, 200)}`);
      return;
    }

    const eventType = msg.type as SignalingEventType;
    const event: SignalingEvent = {
      type: eventType,
      data: msg,
      timestamp: Date.now(),
    };

    // Emit specific event
    this.emit(eventType, msg);

    // Emit generic event
    this.emit("message", event);

    // Log significant events
    switch (eventType) {
      case "connected":
        logger.info(MODULE, `Connected to signaling server as ${(msg as Record<string, unknown>).peerId}`);
        break;
      case "room:created":
        logger.info(MODULE, `Room created: ${(msg as Record<string, unknown>).roomId}`);
        break;
      case "error":
        logger.error(MODULE, `Signaling error: ${(msg as Record<string, unknown>).message}`);
        break;
    }
  }

  private handleDisconnect(reason: string): void {
    const wasConnected = this.state === "connected";
    this.ws = null;
    this.stopHeartbeat();

    if (wasConnected && this.reconnectCount < this.config.reconnectAttempts) {
      this.state = "reconnecting";
      this.emit("state", "reconnecting");

      const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectCount);
      logger.info(MODULE, `Disconnected (${reason}), reconnecting in ${delay}ms (attempt ${this.reconnectCount + 1})`);

      this.reconnectTimer = setTimeout(() => {
        this.reconnectCount++;
        this.connect().catch((err) => {
          logger.error(MODULE, `Reconnect failed: ${err}`);
        });
      }, delay);
    } else {
      this.state = "disconnected";
      this.emit("state", "disconnected");
      logger.info(MODULE, `Disconnected: ${reason}`);
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Heartbeat is sent via sendHeartbeat() by the connection manager
      this.emit("heartbeat:needed");
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectCount = 0;
  }
}

// ─── Type declarations for WebSocket in Node.js ──────────────────
// These are browser types that node-datachannel handles differently
declare class WebSocket {
  constructor(url: string);
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBuffer | Blob): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

declare interface CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
}
