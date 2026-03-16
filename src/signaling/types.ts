// ClawChat Signaling Service — Type Definitions
import type { WebSocket } from "ws";

// ─── Peer Connection ────────────────────────────────────────────────

export interface PeerInfo {
  id: string; // Agent ID (fingerprint of identity key)
  socket: WebSocket;
  roomId: string | null;
  connectedAt: number;
  lastHeartbeat: number;
  metadata: PeerMetadata;
}

export interface PeerMetadata {
  displayName: string;
  version: string;
  publicKeyFingerprint: string; // For TOFU verification
  tags: string[]; // Profile tags summary
  capabilities: string[]; // Supported features
}

// ─── Room Management ────────────────────────────────────────────────

export interface Room {
  id: string;
  type: "pair" | "group";
  peers: Map<string, PeerInfo>;
  createdAt: number;
  expiresAt: number | null;
  createdBy: string;
  maxPeers: number;
  inviteCode: string | null;
  metadata: RoomMetadata;
}

export interface RoomMetadata {
  name?: string;
  description?: string;
}

// ─── Invitation System ──────────────────────────────────────────────

export interface Invitation {
  code: string;
  roomId: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  usedBy: string[];
}

// ─── Signaling Messages ─────────────────────────────────────────────

export type SignalingMessage =
  | ConnectMessage
  | DisconnectMessage
  | HeartbeatMessage
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomLeaveMessage
  | RoomListMessage
  | InviteCreateMessage
  | InviteRedeemMessage
  | SDPMessage
  | ICEMessage
  | ErrorMessage;

export interface ConnectMessage {
  type: "connect";
  peerId: string;
  metadata: PeerMetadata;
  token?: string;
}

export interface DisconnectMessage {
  type: "disconnect";
  peerId: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  peerId: string;
}

export interface RoomCreateMessage {
  type: "room:create";
  peerId: string;
  roomType: "pair" | "group";
  maxPeers?: number;
  metadata?: RoomMetadata;
}

export interface RoomJoinMessage {
  type: "room:join";
  peerId: string;
  roomId: string;
}

export interface RoomLeaveMessage {
  type: "room:leave";
  peerId: string;
  roomId: string;
}

export interface RoomListMessage {
  type: "room:list";
  peerId: string;
}

export interface InviteCreateMessage {
  type: "invite:create";
  peerId: string;
  roomId: string;
  maxUses?: number;
  expiresInHours?: number;
}

export interface InviteRedeemMessage {
  type: "invite:redeem";
  peerId: string;
  inviteCode: string;
}

export interface SDPMessage {
  type: "sdp";
  from: string;
  to: string;
  sdp: RTCSessionDescriptionInit;
}

export interface ICEMessage {
  type: "ice";
  from: string;
  to: string;
  candidate: RTCIceCandidateInit;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
  details?: unknown;
}

// ─── Server Responses ───────────────────────────────────────────────

export type SignalingResponse =
  | { type: "connected"; peerId: string; timestamp: number }
  | { type: "disconnected"; peerId: string }
  | { type: "heartbeat:ack"; peerId: string; timestamp: number }
  | { type: "room:created"; roomId: string; inviteCode: string }
  | { type: "room:joined"; roomId: string; peers: PeerMetadata[] }
  | { type: "room:left"; roomId: string }
  | { type: "room:peer-joined"; roomId: string; peer: PeerMetadata }
  | { type: "room:peer-left"; roomId: string; peerId: string }
  | { type: "room:list"; rooms: RoomSummary[] }
  | { type: "invite:created"; inviteCode: string; expiresAt: number }
  | { type: "invite:redeemed"; roomId: string; peers: PeerMetadata[] }
  | { type: "sdp"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit }
  | { type: "error"; code: string; message: string };

export interface RoomSummary {
  id: string;
  type: "pair" | "group";
  peerCount: number;
  maxPeers: number;
  createdAt: number;
  metadata: RoomMetadata;
}

// ─── Service Configuration ───────────────────────────────────────────

export interface SignalingServiceConfig {
  port: number;
  host: string;
  authToken?: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  roomTtlMs: number;
  invitationTtlMs: number;
  corsOrigins: string[];
  turnServers: RTCIceServer[];
}

export const DEFAULT_SIGNALING_CONFIG: SignalingServiceConfig = {
  port: 3478,
  host: "127.0.0.1",
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 90_000,
  roomTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  invitationTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  corsOrigins: ["*"],
  turnServers: [],
};

// ─── Service State ──────────────────────────────────────────────────

export interface SignalingServiceState {
  running: boolean;
  port: number;
  host: string;
  uptime: number;
  peerCount: number;
  roomCount: number;
  startedAt: number | null;
}