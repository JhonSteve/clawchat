// ClawChat — Transport Layer Type Definitions

// ─── WebRTC Connection States ────────────────────────────────────

export type WebRTCState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface PeerConnection {
  peerId: string;
  state: WebRTCState;
  dataChannels: Map<string, DataChannelInfo>;
  iceConnectionState: string;
  connectedAt: number | null;
  stats: ConnectionStats;
}

export interface DataChannelInfo {
  label: string;
  readyState: "connecting" | "open" | "closing" | "closed";
  bufferedAmount: number;
  maxRetransmits?: number;
  ordered: boolean;
}

export interface ConnectionStats {
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
  roundTripTimeMs: number | null;
  packetsLost: number;
}

// ─── Signaling Client ────────────────────────────────────────────

export type SignalingClientState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface SignalingClientConfig {
  serverUrl: string;
  authToken?: string;
  reconnectAttempts: number;
  reconnectDelayMs: number;
  heartbeatIntervalMs: number;
}

export interface SignalingEvent {
  type: SignalingEventType;
  data: unknown;
  timestamp: number;
}

export type SignalingEventType =
  | "connected"
  | "disconnected"
  | "error"
  | "sdp"
  | "ice"
  | "room:created"
  | "room:joined"
  | "room:left"
  | "room:peer-joined"
  | "room:peer-left"
  | "invite:created"
  | "invite:redeemed"
  | "heartbeat:ack";

// ─── Invitation ──────────────────────────────────────────────────

export interface InvitationCode {
  code: string;
  serverUrl: string;
  roomId: string;
  tempKey: string;
}

// ─── mDNS Discovery ──────────────────────────────────────────────

export interface DiscoveredPeer {
  agentId: string;
  host: string;
  port: number;
  displayName: string;
  tags: string[];
  publicKeyFingerprint: string;
  timestamp: number;
}

export interface DiscoveryConfig {
  serviceType: string;
  serviceName: string;
  port: number;
  txtRecord: Record<string, string>;
}

// ─── Connection Manager Events ───────────────────────────────────

export type ConnectionEvent =
  | { type: "peer-connected"; peerId: string }
  | { type: "peer-disconnected"; peerId: string }
  | { type: "peer-reconnecting"; peerId: string }
  | { type: "message"; peerId: string; data: Uint8Array }
  | { type: "error"; peerId?: string; error: Error }
  | { type: "signaling-state"; state: SignalingClientState }
  | { type: "discovery"; peer: DiscoveredPeer };

export type ConnectionEventHandler = (event: ConnectionEvent) => void;

// ─── Data Channel Labels ─────────────────────────────────────────

export const CHANNEL_LABELS = {
  CONTROL: "claw-ctrl",
  MESSAGE: "claw-msg",
  KNOWLEDGE: "claw-kb",
} as const;

export type ChannelLabel = (typeof CHANNEL_LABELS)[keyof typeof CHANNEL_LABELS];
