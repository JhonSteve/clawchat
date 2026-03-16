// ClawChat Signaling Service — Room Management
import { randomBytes } from "node:crypto";
import type { Room, RoomMetadata, RoomSummary, PeerInfo, Invitation } from "./types.ts";

export class RoomManager {
  private rooms = new Map<string, Room>();
  private invitations = new Map<string, Invitation>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private roomTtlMs: number,
    private invitationTtlMs: number,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (this.cleanupInterval) {
      return; // Already started
    }
    // Periodic cleanup of expired rooms and invitations
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.rooms.clear();
    this.invitations.clear();
  }

  // ─── Room Operations ────────────────────────────────────────────

  createRoom(
    creatorId: string,
    type: "pair" | "group",
    maxPeers?: number,
    metadata?: RoomMetadata,
  ): Room {
    const roomId = this.generateId("room");
    const now = Date.now();

    const room: Room = {
      id: roomId,
      type,
      peers: new Map(),
      createdAt: now,
      expiresAt: now + this.roomTtlMs,
      createdBy: creatorId,
      maxPeers: maxPeers ?? (type === "pair" ? 2 : 100),
      inviteCode: null,
      metadata: metadata ?? {},
    };

    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomSummary(roomId: string): RoomSummary | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: room.id,
      type: room.type,
      peerCount: room.peers.size,
      maxPeers: room.maxPeers,
      createdAt: room.createdAt,
      metadata: room.metadata,
    };
  }

  listRooms(): RoomSummary[] {
    const summaries: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      summaries.push({
        id: room.id,
        type: room.type,
        peerCount: room.peers.size,
        maxPeers: room.maxPeers,
        createdAt: room.createdAt,
        metadata: room.metadata,
      });
    }
    return summaries;
  }

  addPeerToRoom(roomId: string, peer: PeerInfo): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "ROOM_NOT_FOUND" };
    }

    if (room.peers.size >= room.maxPeers) {
      return { success: false, error: "ROOM_FULL" };
    }

    if (room.peers.has(peer.id)) {
      return { success: false, error: "ALREADY_IN_ROOM" };
    }

    room.peers.set(peer.id, peer);
    peer.roomId = roomId;

    // Reset expiry when room is active
    room.expiresAt = Date.now() + this.roomTtlMs;

    return { success: true };
  }

  removePeerFromRoom(roomId: string, peerId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "ROOM_NOT_FOUND" };
    }

    if (!room.peers.has(peerId)) {
      return { success: false, error: "NOT_IN_ROOM" };
    }

    room.peers.delete(peerId);

    // For pair rooms, close when one leaves
    if (room.type === "pair" || room.peers.size === 0) {
      this.rooms.delete(roomId);
    }

    return { success: true };
  }

  getOtherPeersInRoom(roomId: string, excludePeerId: string): PeerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const others: PeerInfo[] = [];
    for (const [id, peer] of room.peers) {
      if (id !== excludePeerId) {
        others.push(peer);
      }
    }
    return others;
  }

  removePeerFromAllRooms(peerId: string): string[] {
    const affectedRooms: string[] = [];

    for (const [roomId, room] of this.rooms) {
      if (room.peers.has(peerId)) {
        room.peers.delete(peerId);
        affectedRooms.push(roomId);

        // For pair rooms, close when one leaves
        if (room.type === "pair" || room.peers.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }

    return affectedRooms;
  }

  // ─── Invitation System ──────────────────────────────────────────

  createInvitation(
    roomId: string,
    creatorId: string,
    maxUses: number = 1,
    expiresInHours: number = 24,
  ): Invitation | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const code = this.generateInviteCode();
    const now = Date.now();

    const invitation: Invitation = {
      code,
      roomId,
      createdBy: creatorId,
      createdAt: now,
      expiresAt: now + expiresInHours * 60 * 60 * 1000,
      maxUses,
      usedCount: 0,
      usedBy: [],
    };

    this.invitations.set(code, invitation);
    room.inviteCode = code;

    return invitation;
  }

  redeemInvitation(code: string, peerId: string): { success: boolean; roomId?: string; error?: string } {
    const invitation = this.invitations.get(code);
    if (!invitation) {
      return { success: false, error: "INVALID_INVITE_CODE" };
    }

    if (Date.now() > invitation.expiresAt) {
      this.invitations.delete(code);
      return { success: false, error: "INVITE_EXPIRED" };
    }

    if (invitation.usedCount >= invitation.maxUses) {
      this.invitations.delete(code);
      return { success: false, error: "INVITE_EXHAUSTED" };
    }

    if (invitation.usedBy.includes(peerId)) {
      return { success: false, error: "ALREADY_REDEEMED" };
    }

    invitation.usedCount++;
    invitation.usedBy.push(peerId);

    // Single-use invitations are deleted after redemption
    if (invitation.usedCount >= invitation.maxUses) {
      this.invitations.delete(code);
    }

    return { success: true, roomId: invitation.roomId };
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();

    // Clean expired rooms
    for (const [id, room] of this.rooms) {
      if (room.expiresAt && now > room.expiresAt) {
        this.rooms.delete(id);
      }
    }

    // Clean expired invitations
    for (const [code, invitation] of this.invitations) {
      if (now > invitation.expiresAt) {
        this.invitations.delete(code);
      }
    }
  }

  // ─── ID Generation ──────────────────────────────────────────────

  private generateId(prefix: string): string {
    const hex = randomBytes(16).toString("hex");
    return `${prefix}_${hex}`;
  }

  private generateInviteCode(): string {
    // Format: claw:BASE64(random_bytes)
    const bytes = randomBytes(24);
    return `claw:${bytes.toString("base64url")}`;
  }

  // ─── Stats ──────────────────────────────────────────────────────

  getStats() {
    return {
      totalRooms: this.rooms.size,
      totalInvitations: this.invitations.size,
      roomsByType: {
        pair: [...this.rooms.values()].filter((r) => r.type === "pair").length,
        group: [...this.rooms.values()].filter((r) => r.type === "group").length,
      },
      totalPeers: [...this.rooms.values()].reduce((sum, r) => sum + r.peers.size, 0),
    };
  }
}