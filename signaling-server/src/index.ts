// ClawChat Signaling Server — Entry Point
import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "node:http";
import { SignalingHandler } from "./signaling.ts";
import { RoomManager } from "./room.ts";
import { PeerManager } from "./peer.ts";
import { DEFAULT_CONFIG, type SignalingServerConfig } from "./types.ts";

function loadConfig(): SignalingServerConfig {
  return {
    ...DEFAULT_CONFIG,
    port: parseInt(process.env.CLAWCHAT_SIGNALING_PORT ?? String(DEFAULT_CONFIG.port)),
    host: process.env.CLAWCHAT_SIGNALING_HOST ?? DEFAULT_CONFIG.host,
    authToken: process.env.CLAWCHAT_SIGNALING_TOKEN,
    heartbeatIntervalMs: parseInt(
      process.env.CLAWCHAT_HEARTBEAT_INTERVAL ?? String(DEFAULT_CONFIG.heartbeatIntervalMs),
    ),
    heartbeatTimeoutMs: parseInt(
      process.env.CLAWCHAT_HEARTBEAT_TIMEOUT ?? String(DEFAULT_CONFIG.heartbeatTimeoutMs),
    ),
    turnServers: process.env.CLAWCHAT_TURN_SERVERS
      ? JSON.parse(process.env.CLAWCHAT_TURN_SERVERS)
      : [],
  };
}

export function startSignalingServer(config?: Partial<SignalingServerConfig>) {
  const cfg = { ...loadConfig(), ...config };

  // ─── HTTP Server (health check + TURN config endpoint) ──────────
  const httpServer = createServer((req, res) => {
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
          turnServers: cfg.turnServers,
          heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        }),
      );
      return;
    }

    if (req.url === "/stats") {
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
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const roomManager = new RoomManager(cfg.roomTtlMs, cfg.invitationTtlMs);
  const peerManager = new PeerManager(cfg.heartbeatIntervalMs, cfg.heartbeatTimeoutMs);
  const handler = new SignalingHandler(wss, roomManager, peerManager, cfg);

  wss.on("connection", (socket: WebSocket, _req) => {
    // Set binary type
    socket.binaryType = "nodebuffer";

    socket.on("message", (data: Buffer) => {
      try {
        handler.handleMessage(socket, data.toString("utf-8"));
      } catch (err) {
        console.error("[signaling] Error handling message:", err);
      }
    });

    socket.on("close", (_code, _reason) => {
      const peer = peerManager.getPeerBySocket(socket);
      if (peer) {
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

        console.log(`[signaling] Peer ${peer.id.slice(0, 8)}... disconnected (socket closed)`);
      }
    });

    socket.on("error", (err) => {
      console.error("[signaling] Socket error:", err);
    });
  });

  wss.on("error", (err) => {
    console.error("[signaling] WebSocketServer error:", err);
  });

  // ─── Start Server ──────────────────────────────────────────────
  httpServer.listen(cfg.port, cfg.host, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   🐾 ClawChat Signaling Server              ║
╠══════════════════════════════════════════════════════════════╣
║  WebSocket: ws://${cfg.host}:${cfg.port}/ws                     ║
║  Health:    http://${cfg.host}:${cfg.port}/health               ║
║  Config:    http://${cfg.host}:${cfg.port}/config               ║
║  Stats:     http://${cfg.host}:${cfg.port}/stats                ║
╠══════════════════════════════════════════════════════════════╣
║  Auth:      ${cfg.authToken ? "ENABLED" : "DISABLED (set CLAWCHAT_SIGNALING_TOKEN)"}               ║
║  Heartbeat: ${cfg.heartbeatIntervalMs / 1000}s interval, ${cfg.heartbeatTimeoutMs / 1000}s timeout ║
║  Room TTL:  ${cfg.roomTtlMs / 1000 / 60 / 60}h                       ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });

  // ─── Graceful Shutdown ─────────────────────────────────────────
  const shutdown = (signal: string) => {
    console.log(`\n[signaling] Received ${signal}, shutting down...`);

    wss.clients.forEach((client) => {
      client.close(1001, "Server shutting down");
    });

    httpServer.close(() => {
      console.log("[signaling] Server closed");
      process.exit(0);
    });

    // Force exit after 5s
    setTimeout(() => {
      console.log("[signaling] Force exit");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return { httpServer, wss, roomManager, peerManager };
}

// ─── CLI Entry ──────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startSignalingServer();
}
