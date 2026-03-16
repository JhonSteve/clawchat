// ClawChat Signaling Service — Signaling Protocol Handler
import type { WebSocket, WebSocketServer } from "ws";
import type {
  SignalingMessage,
  SignalingResponse,
  SignalingServiceConfig,
} from "./types.ts";
import { RoomManager } from "./room.ts";
import { PeerManager } from "./peer.ts";

export class SignalingHandler {
  constructor(
    private wss: WebSocketServer,
    private roomManager: RoomManager,
    private peerManager: PeerManager,
    private config: SignalingServiceConfig,
    private log: (category: string, message: string) => void,
  ) {}

  // ─── Message Dispatch ───────────────────────────────────────────

  handleMessage(socket: WebSocket, raw: string): void {
    let message: SignalingMessage;
    try {
      message = JSON.parse(raw) as SignalingMessage;
    } catch {
      this.sendError(socket, "PARSE_ERROR", "Invalid JSON message");
      return;
    }

    switch (message.type) {
      case "connect":
        this.handleConnect(socket, message);
        break;
      case "disconnect":
        this.handleDisconnect(message);
        break;
      case "heartbeat":
        this.handleHeartbeat(socket, message);
        break;
      case "room:create":
        this.handleRoomCreate(socket, message);
        break;
      case "room:join":
        this.handleRoomJoin(socket, message);
        break;
      case "room:leave":
        this.handleRoomLeave(socket, message);
        break;
      case "room:list":
        this.handleRoomList(socket, message);
        break;
      case "invite:create":
        this.handleInviteCreate(socket, message);
        break;
      case "invite:redeem":
        this.handleInviteRedeem(socket, message);
        break;
      case "sdp":
        this.handleSDP(message);
        break;
      case "ice":
        this.handleICE(message);
        break;
      default:
        this.sendError(socket, "UNKNOWN_MESSAGE_TYPE", "Unknown message type");
    }
  }

  // ─── Connection Handlers ────────────────────────────────────────

  private handleConnect(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "connect" }>,
  ): void {
    // Auth check
    if (this.config.authToken && msg.token !== this.config.authToken) {
      this.sendError(socket, "AUTH_FAILED", "Invalid authentication token");
      socket.close(1008, "Authentication failed");
      return;
    }

    const result = this.peerManager.registerPeer(msg.peerId, socket, msg.metadata);

    if (!result.success) {
      this.sendError(socket, "CONNECT_FAILED", result.error ?? "Connection failed");
      return;
    }

    this.send(socket, {
      type: "connected",
      peerId: msg.peerId,
      timestamp: Date.now(),
    });

    this.log(
      "signaling",
      `Peer ${msg.metadata.displayName} (${msg.peerId.slice(0, 8)}...) connected` +
        (result.replaced ? " (replaced)" : ""),
    );
  }

  private handleDisconnect(msg: Extract<SignalingMessage, { type: "disconnect" }>): void {
    this.disconnectPeer(msg.peerId);
  }

  private handleHeartbeat(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "heartbeat" }>,
  ): void {
    const updated = this.peerManager.updateHeartbeat(msg.peerId);
    if (updated) {
      this.send(socket, {
        type: "heartbeat:ack",
        peerId: msg.peerId,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Room Handlers ──────────────────────────────────────────────

  private handleRoomCreate(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "room:create" }>,
  ): void {
    const peer = this.peerManager.getPeer(msg.peerId);
    if (!peer) {
      this.sendError(socket, "NOT_CONNECTED", "Peer not connected");
      return;
    }

    const room = this.roomManager.createRoom(
      msg.peerId,
      msg.roomType ?? "pair",
      msg.maxPeers,
      msg.metadata,
    );

    // Auto-join the creator
    this.roomManager.addPeerToRoom(room.id, peer);

    // Generate invitation code
    const invitation = this.roomManager.createInvitation(room.id, msg.peerId);

    this.send(socket, {
      type: "room:created",
      roomId: room.id,
      inviteCode: invitation?.code ?? "",
    });

    this.log("signaling", `Room ${room.id} created by ${msg.peerId.slice(0, 8)}...`);
  }

  private handleRoomJoin(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "room:join" }>,
  ): void {
    const peer = this.peerManager.getPeer(msg.peerId);
    if (!peer) {
      this.sendError(socket, "NOT_CONNECTED", "Peer not connected");
      return;
    }

    const result = this.roomManager.addPeerToRoom(msg.roomId, peer);
    if (!result.success) {
      this.sendError(socket, result.error ?? "JOIN_FAILED", "Failed to join room");
      return;
    }

    // Get metadata of other peers in room
    const otherPeers = this.roomManager.getOtherPeersInRoom(msg.roomId, msg.peerId);
    const peerMetadatas = otherPeers.map((p) => p.metadata);

    this.send(socket, {
      type: "room:joined",
      roomId: msg.roomId,
      peers: peerMetadatas,
    });

    // Notify other peers
    for (const otherPeer of otherPeers) {
      this.send(otherPeer.socket, {
        type: "room:peer-joined",
        roomId: msg.roomId,
        peer: peer.metadata,
      });
    }

    this.log("signaling", `Peer ${msg.peerId.slice(0, 8)}... joined room ${msg.roomId}`);
  }

  private handleRoomLeave(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "room:leave" }>,
  ): void {
    const otherPeers = this.roomManager.getOtherPeersInRoom(msg.roomId, msg.peerId);
    const result = this.roomManager.removePeerFromRoom(msg.roomId, msg.peerId);

    if (!result.success) {
      this.sendError(socket, result.error ?? "LEAVE_FAILED", "Failed to leave room");
      return;
    }

    this.send(socket, {
      type: "room:left",
      roomId: msg.roomId,
    });

    // Notify remaining peers
    for (const otherPeer of otherPeers) {
      if (otherPeer.id !== msg.peerId) {
        this.send(otherPeer.socket, {
          type: "room:peer-left",
          roomId: msg.roomId,
          peerId: msg.peerId,
        });
      }
    }
  }

  private handleRoomList(
    socket: WebSocket,
    _msg: Extract<SignalingMessage, { type: "room:list" }>,
  ): void {
    const rooms = this.roomManager.listRooms();
    this.send(socket, {
      type: "room:list",
      rooms,
    });
  }

  // ─── Invitation Handlers ────────────────────────────────────────

  private handleInviteCreate(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "invite:create" }>,
  ): void {
    const invitation = this.roomManager.createInvitation(
      msg.roomId,
      msg.peerId,
      msg.maxUses,
      msg.expiresInHours,
    );

    if (!invitation) {
      this.sendError(socket, "ROOM_NOT_FOUND", "Room not found");
      return;
    }

    this.send(socket, {
      type: "invite:created",
      inviteCode: invitation.code,
      expiresAt: invitation.expiresAt,
    });
  }

  private handleInviteRedeem(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: "invite:redeem" }>,
  ): void {
    const result = this.roomManager.redeemInvitation(msg.inviteCode, msg.peerId);
    if (!result.success) {
      this.sendError(socket, result.error ?? "REDEEM_FAILED", "Failed to redeem invitation");
      return;
    }

    // Auto-join the room
    const peer = this.peerManager.getPeer(msg.peerId);
    if (peer && result.roomId) {
      this.roomManager.addPeerToRoom(result.roomId, peer);

      const otherPeers = this.roomManager.getOtherPeersInRoom(result.roomId, msg.peerId);
      const peerMetadatas = otherPeers.map((p) => p.metadata);

      this.send(socket, {
        type: "invite:redeemed",
        roomId: result.roomId,
        peers: peerMetadatas,
      });

      // Notify other peers
      for (const otherPeer of otherPeers) {
        this.send(otherPeer.socket, {
          type: "room:peer-joined",
          roomId: result.roomId,
          peer: peer.metadata,
        });
      }
    }
  }

  // ─── SDP/ICE Relay ──────────────────────────────────────────────

  private handleSDP(msg: Extract<SignalingMessage, { type: "sdp" }>): void {
    const targetPeer = this.peerManager.getPeer(msg.to);
    if (targetPeer) {
      this.send(targetPeer.socket, {
        type: "sdp",
        from: msg.from,
        sdp: msg.sdp,
      });
    }
  }

  private handleICE(msg: Extract<SignalingMessage, { type: "ice" }>): void {
    const targetPeer = this.peerManager.getPeer(msg.to);
    if (targetPeer) {
      this.send(targetPeer.socket, {
        type: "ice",
        from: msg.from,
        candidate: msg.candidate,
      });
    }
  }

  // ─── Disconnection ──────────────────────────────────────────────

  disconnectPeer(peerId: string): void {
    const affectedRooms = this.roomManager.removePeerFromAllRooms(peerId);
    this.peerManager.unregisterPeer(peerId);

    // Notify remaining peers in affected rooms
    for (const roomId of affectedRooms) {
      const remainingPeers = this.roomManager.getOtherPeersInRoom(roomId, peerId);
      for (const peer of remainingPeers) {
        this.send(peer.socket, {
          type: "room:peer-left",
          roomId,
          peerId,
        });
      }
    }

    this.log("signaling", `Peer ${peerId.slice(0, 8)}... disconnected`);
  }

  // ─── Send Helpers ───────────────────────────────────────────────

  private send(socket: WebSocket, response: SignalingResponse): void {
    if (socket.readyState === 1) {
      // WebSocket.OPEN
      socket.send(JSON.stringify(response));
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, {
      type: "error",
      code,
      message,
    });
  }
}