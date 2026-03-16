// ClawChat Signaling Server — Peer Management
import type { WebSocket } from "ws";
import type { PeerInfo, PeerMetadata } from "./types.ts";

export class PeerManager {
  private peers = new Map<string, PeerInfo>();
  private socketToPeer = new Map<WebSocket, string>();

  constructor(
    private heartbeatIntervalMs: number,
    private heartbeatTimeoutMs: number,
  ) {
    // Periodic check for stale peers
    setInterval(() => this.checkStalePeers(), this.heartbeatIntervalMs);
  }

  // ─── Peer Registration ──────────────────────────────────────────

  registerPeer(
    peerId: string,
    socket: WebSocket,
    metadata: PeerMetadata,
  ): { success: boolean; error?: string; replaced?: boolean } {
    const existingPeer = this.peers.get(peerId);
    const now = Date.now();

    if (existingPeer) {
      // Replace existing connection (reconnect scenario)
      existingPeer.socket.close(1000, "Replaced by new connection");
      this.socketToPeer.delete(existingPeer.socket);

      existingPeer.socket = socket;
      existingPeer.connectedAt = now;
      existingPeer.lastHeartbeat = now;
      existingPeer.metadata = metadata;

      this.socketToPeer.set(socket, peerId);
      return { success: true, replaced: true };
    }

    const peer: PeerInfo = {
      id: peerId,
      socket,
      roomId: null,
      connectedAt: now,
      lastHeartbeat: now,
      metadata,
    };

    this.peers.set(peerId, peer);
    this.socketToPeer.set(socket, peerId);

    return { success: true, replaced: false };
  }

  unregisterPeer(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    this.socketToPeer.delete(peer.socket);
    this.peers.delete(peerId);
    return true;
  }

  unregisterBySocket(socket: WebSocket): string | null {
    const peerId = this.socketToPeer.get(socket);
    if (!peerId) return null;

    this.socketToPeer.delete(socket);
    this.peers.delete(peerId);
    return peerId;
  }

  // ─── Peer Lookup ────────────────────────────────────────────────

  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  getPeerBySocket(socket: WebSocket): PeerInfo | undefined {
    const peerId = this.socketToPeer.get(socket);
    if (!peerId) return undefined;
    return this.peers.get(peerId);
  }

  getAllPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }

  getOnlinePeerIds(): string[] {
    return [...this.peers.keys()];
  }

  // ─── Heartbeat ──────────────────────────────────────────────────

  updateHeartbeat(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    peer.lastHeartbeat = Date.now();
    return true;
  }

  private checkStalePeers(): void {
    const now = Date.now();
    const stalePeers: string[] = [];

    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastHeartbeat > this.heartbeatTimeoutMs) {
        stalePeers.push(peerId);
      }
    }

    for (const peerId of stalePeers) {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.socket.close(1001, "Heartbeat timeout");
        this.socketToPeer.delete(peer.socket);
        this.peers.delete(peerId);
      }
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────

  getStats() {
    return {
      totalPeers: this.peers.size,
      peersInRooms: [...this.peers.values()].filter((p) => p.roomId !== null).length,
    };
  }
}
