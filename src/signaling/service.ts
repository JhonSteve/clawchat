// ClawChat Signaling Service — Integrated Service for OpenClaw Plugin
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server as HttpServer } from "node:http";
import { SignalingHandler } from "./handler.ts";
import { RoomManager } from "./room.ts";
import { PeerManager } from "./peer.ts";
import {
  DEFAULT_SIGNALING_CONFIG,
  type SignalingServiceConfig,
  type SignalingServiceState,
} from "./types.ts";

export interface SignalingService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): SignalingServiceState;
  getConfig(): SignalingServiceConfig;
}

export interface SignalingServiceOptions {
  port?: number;
  host?: string;
  authToken?: string;
  onLog?: (category: string, message: string) => void;
}

/**
 * Create a signaling service that can be embedded in the OpenClaw plugin.
 *
 * @example
 * ```typescript
 * const service = createSignalingService({ port: 3478 });
 * await service.start();
 * // ... later
 * await service.stop();
 * ```
 */
export function createSignalingService(options: SignalingServiceOptions = {}): SignalingService {
  const config: SignalingServiceConfig = {
    ...DEFAULT_SIGNALING_CONFIG,
    ...options,
  };

  const log = options.onLog ?? ((category: string, message: string) => {
    console.log(`[${category}] ${message}`);
  });

  // Service state
  let httpServer: HttpServer | null = null;
  let wss: WebSocketServer | null = null;
  let roomManager: RoomManager | null = null;
  let peerManager: PeerManager | null = null;
  let handler: SignalingHandler | null = null;
  let startedAt: number | null = null;

  const service: SignalingService = {
    async start(): Promise<void> {
      if (httpServer !== null) {
        log("signaling", "Service already running");
        return;
      }

      // Initialize managers
      roomManager = new RoomManager(config.roomTtlMs, config.invitationTtlMs);
      peerManager = new PeerManager(config.heartbeatIntervalMs, config.heartbeatTimeoutMs);

      // Start managers
      roomManager.start();
      peerManager.start();

      // ─── HTTP Server (health check + TURN config endpoint) ──────────
      httpServer = createServer((req, res) => {
        // CORS headers
        const origin = req.headers.origin ?? "*";
        res.setHeader("Access-Control-Allow-Origin", config.corsOrigins.includes("*") ? "*" : origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              service: "clawchat-signaling",
              version: "0.1.0",
              uptime: process.uptime(),
              timestamp: Date.now(),
            }),
          );
          return;
        }

        if (req.url === "/config") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({
              turnServers: config.turnServers,
              heartbeatIntervalMs: config.heartbeatIntervalMs,
            }),
          );
          return;
        }

        if (req.url === "/stats") {
          if (!roomManager || !peerManager) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Service not ready" }));
            return;
          }
          const roomStats = roomManager.getStats();
          const peerStats = peerManager.getStats();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              rooms: roomStats,
              peers: peerStats,
              uptime: process.uptime(),
            }),
          );
          return;
        }

        res.writeHead(404);
        res.end("Not Found");
      });

      // ─── WebSocket Server ──────────────────────────────────────────
      wss = new WebSocketServer({ server: httpServer, path: "/ws" });

      handler = new SignalingHandler(wss, roomManager, peerManager, config, log);

      wss.on("connection", (socket: WebSocket) => {
        // Set binary type
        socket.binaryType = "nodebuffer";

        socket.on("message", (data: Buffer) => {
          try {
            handler?.handleMessage(socket, data.toString("utf-8"));
          } catch (err) {
            log("signaling", `Error handling message: ${err}`);
          }
        });

        socket.on("close", () => {
          if (!peerManager) return;
          const peer = peerManager.getPeerBySocket(socket);
          if (peer && roomManager) {
            // Trigger disconnect handling via signaling handler
            const affectedRooms = roomManager.removePeerFromAllRooms(peer.id);
            peerManager.unregisterBySocket(socket);

            // Notify remaining peers
            for (const roomId of affectedRooms) {
              const remainingPeers = roomManager.getOtherPeersInRoom(roomId, peer.id);
              for (const otherPeer of remainingPeers) {
                if (otherPeer.socket.readyState === 1) {
                  otherPeer.socket.send(
                    JSON.stringify({
                      type: "room:peer-left",
                      roomId,
                      peerId: peer.id,
                    }),
                  );
                }
              }
            }

            log("signaling", `Peer ${peer.id.slice(0, 8)}... disconnected (socket closed)`);
          }
        });

        socket.on("error", (err) => {
          log("signaling", `Socket error: ${err}`);
        });
      });

      wss.on("error", (err) => {
        log("signaling", `WebSocketServer error: ${err}`);
      });

      // ─── Start Server ──────────────────────────────────────────────
      return new Promise((resolve, reject) => {
        httpServer?.listen(config.port, config.host, () => {
          startedAt = Date.now();
          log(
            "signaling",
            `🐾 ClawChat Signaling Service started on ws://${config.host}:${config.port}/ws`,
          );
          resolve();
        });

        httpServer?.on("error", (err) => {
          log("signaling", `Server error: ${err}`);
          reject(err);
        });
      });
    },

    async stop(): Promise<void> {
      if (httpServer === null) {
        log("signaling", "Service not running");
        return;
      }

      log("signaling", "Shutting down signaling service...");

      // Close all WebSocket connections
      if (wss) {
        for (const client of wss.clients) {
          try {
            client.close(1001, "Server shutting down");
          } catch {
            // Ignore errors during shutdown
          }
        }
      }

      // Stop managers
      roomManager?.stop();
      peerManager?.stop();

      // Close HTTP server
      await new Promise<void>((resolve) => {
        httpServer?.close(() => {
          log("signaling", "HTTP server closed");
          resolve();
        });

        // Force close after timeout
        setTimeout(() => {
          httpServer?.closeAllConnections();
          resolve();
        }, 2000);
      });

      // Reset state
      httpServer = null;
      wss = null;
      roomManager = null;
      peerManager = null;
      handler = null;
      startedAt = null;

      log("signaling", "Signaling service stopped");
    },

    getState(): SignalingServiceState {
      return {
        running: httpServer !== null,
        port: config.port,
        host: config.host,
        uptime: startedAt ? Date.now() - startedAt : 0,
        peerCount: peerManager?.getStats().totalPeers ?? 0,
        roomCount: roomManager?.getStats().totalRooms ?? 0,
        startedAt,
      };
    },

    getConfig(): SignalingServiceConfig {
      return { ...config };
    },
  };

  return service;
}

// Re-export types and utilities
export { DEFAULT_SIGNALING_CONFIG } from "./types.ts";
export type {
  SignalingServiceConfig as SignalingConfig,
  SignalingMessage,
  SignalingResponse,
  PeerInfo,
  PeerMetadata,
  Room,
  RoomMetadata,
  RoomSummary,
  Invitation,
} from "./types.ts";
export { RoomManager } from "./room.ts";
export { PeerManager } from "./peer.ts";
export { SignalingHandler } from "./handler.ts";