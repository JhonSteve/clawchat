// ClawChat — Connection Manager (Main Transport Orchestrator)
import { EventEmitter } from "node:events";
import { WebRTCManager } from "./webrtc.ts";
import { SignalingClient } from "./signaling-client.ts";
import { MdnsDiscovery } from "./mdns.ts";
import { InvitationManager } from "./invitation.ts";
import { logger } from "../utils/logger.ts";
import type {
  ConnectionEvent,
  ConnectionEventHandler,
  SignalingClientState,
  DiscoveredPeer,
  PeerConnection,
} from "./types.ts";
import { CHANNEL_LABELS } from "./types.ts";

const MODULE = "connection";

export interface ConnectionManagerConfig {
  signalingServer?: string;
  signalingAuthToken?: string;
  turnServers?: string[];
  enableMdns: boolean;
  mdnsPort: number;
  maxReconnectAttempts: number;
  autoReconnect: boolean;
}

const DEFAULT_CONFIG: ConnectionManagerConfig = {
  enableMdns: true,
  mdnsPort: 3479,
  maxReconnectAttempts: 5,
  autoReconnect: true,
};

export class ConnectionManager extends EventEmitter {
  private config: ConnectionManagerConfig;
  private webrtc: WebRTCManager;
  private signaling: SignalingClient | null = null;
  private mdns: MdnsDiscovery;
  private invitation: InvitationManager;
  private myPeerId: string;
  private myMetadata: Record<string, unknown>;
  private isInitialized = false;

  constructor(
    peerId: string,
    metadata: Record<string, unknown>,
    config: Partial<ConnectionManagerConfig> = {},
  ) {
    super();
    this.myPeerId = peerId;
    this.myMetadata = metadata;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.webrtc = new WebRTCManager(this.config.turnServers, this.config.maxReconnectAttempts);
    this.mdns = new MdnsDiscovery(this.config.mdnsPort);
    this.invitation = new InvitationManager();

    this.setupEventForwarding();
  }

  // ─── Initialization ───────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Start mDNS discovery if enabled
    if (this.config.enableMdns) {
      await this.mdns.startDiscovery();
    }

    // Auto-connect to signaling server if configured
    if (this.config.signalingServer) {
      await this.connectSignaling(this.config.signalingServer);
    }

    this.isInitialized = true;
    logger.info(MODULE, "Connection manager initialized");
  }

  // ─── Signaling Connection ─────────────────────────────────────

  async connectSignaling(serverUrl: string, authToken?: string): Promise<void> {
    if (this.signaling) {
      this.signaling.disconnect();
    }

    this.signaling = new SignalingClient({
      serverUrl,
      authToken: authToken ?? this.config.signalingAuthToken,
    });

    this.setupSignalingHandlers();

    await this.signaling.connect();

    // Register with signaling server
    this.signaling.sendConnect(this.myPeerId, this.myMetadata);

    logger.info(MODULE, `Connected to signaling server: ${serverUrl}`);
  }

  disconnectSignaling(): void {
    if (this.signaling) {
      this.signaling.disconnect();
      this.signaling = null;
    }
  }

  // ─── Peer Connection ──────────────────────────────────────────

  async connectViaInvitation(inviteCode: string): Promise<void> {
    const payload = this.invitation.redeemInvitation(inviteCode);
    if (!payload) {
      throw new Error("Invalid or expired invitation code");
    }

    // Connect to the signaling server in the invitation
    if (!this.signaling || !this.signaling.isConnected()) {
      await this.connectSignaling(payload.serverUrl);
    }

    // Redeem the invitation via signaling
    this.signaling!.redeemInvite(this.myPeerId, inviteCode);
  }

  async connectViaMdns(peer: DiscoveredPeer): Promise<void> {
    // Create WebRTC offer for direct LAN connection
    const offer = await this.webrtc.createOffer(peer.agentId);
    
    // For mDNS, we'd need a different signaling mechanism
    // For now, log the discovery
    logger.info(MODULE, `mDNS peer discovered: ${peer.displayName} at ${peer.host}:${peer.port}`);
    
    this.emit({
      type: "discovery",
      peer,
    });
  }

  // ─── Message Sending ──────────────────────────────────────────

  async send(peerId: string, data: Uint8Array): Promise<void> {
    await this.webrtc.send(peerId, data, CHANNEL_LABELS.MESSAGE);
  }

  async broadcast(data: Uint8Array): Promise<void> {
    await this.webrtc.broadcast(data, CHANNEL_LABELS.MESSAGE);
  }

  // ─── Room Management ──────────────────────────────────────────

  createRoom(roomType: "pair" | "group" = "pair"): void {
    if (!this.signaling || !this.signaling.isConnected()) {
      throw new Error("Not connected to signaling server");
    }
    this.signaling.createRoom(this.myPeerId, roomType);
  }

  joinRoom(roomId: string): void {
    if (!this.signaling || !this.signaling.isConnected()) {
      throw new Error("Not connected to signaling server");
    }
    this.signaling.joinRoom(this.myPeerId, roomId);
  }

  createInviteCode(serverUrl: string, roomId: string, expiresInHours?: number): string {
    const invitation = this.invitation.createInvitation(serverUrl, roomId, expiresInHours);
    return invitation.code;
  }

  // ─── Status ───────────────────────────────────────────────────

  getConnectedPeers(): string[] {
    return this.webrtc.getConnectedPeers();
  }

  getPeerConnection(peerId: string): PeerConnection | null {
    return this.webrtc.getPeerConnection(peerId);
  }

  getSignalingState(): SignalingClientState | "not-configured" {
    return this.signaling?.getState() ?? "not-configured";
  }

  getDiscoveredPeers(): DiscoveredPeer[] {
    return this.mdns.getDiscoveredPeers();
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    this.disconnectSignaling();
    await this.mdns.stopDiscovery();
    await this.mdns.unpublishService();
    this.webrtc.disconnectAll();
    this.isInitialized = false;
    logger.info(MODULE, "Connection manager shut down");
  }

  // ─── Private Methods ──────────────────────────────────────────

  private setupEventForwarding(): void {
    // Forward WebRTC events
    this.webrtc.on("message", ({ peerId, data }: { peerId: string; data: Uint8Array }) => {
      this.emit({ type: "message", peerId, data });
    });

    this.webrtc.on("channel-open", ({ peerId }: { peerId: string }) => {
      this.emit({ type: "peer-connected", peerId });
    });

    this.webrtc.on("channel-close", ({ peerId }: { peerId: string }) => {
      this.emit({ type: "peer-disconnected", peerId });
    });

    this.webrtc.on("channel-error", ({ peerId, error }: { peerId: string; error: string }) => {
      this.emit({ type: "error", peerId, error: new Error(error) });
    });

    // Forward mDNS events
    this.mdns.on("peer-discovered", (peer: DiscoveredPeer) => {
      this.emit({ type: "discovery", peer });
    });

    this.mdns.on("peer-lost", (peer: DiscoveredPeer) => {
      logger.info(MODULE, `mDNS peer lost: ${peer.displayName}`);
    });
  }

  private setupSignalingHandlers(): void {
    if (!this.signaling) return;

    // State changes
    this.signaling.on("state", (state: SignalingClientState) => {
      this.emit({ type: "signaling-state", state });
    });

    // Heartbeat
    this.signaling.on("heartbeat:needed", () => {
      this.signaling!.sendHeartbeat(this.myPeerId);
    });

    // SDP relay — for WebRTC handshake
    this.signaling.on("sdp", async (msg: { from: string; sdp: RTCSessionDescriptionInit }) => {
      try {
        if (msg.sdp.type === "offer") {
          const answer = await this.webrtc.createAnswer(msg.from, msg.sdp.sdp!, msg.sdp.type);
          this.signaling!.sendSDP(this.myPeerId, msg.from, {
            type: "answer",
            sdp: answer.sdp,
          });
        } else if (msg.sdp.type === "answer") {
          await this.webrtc.setRemoteDescription(msg.from, msg.sdp.sdp!, msg.sdp.type);
        }
      } catch (err) {
        logger.error(MODULE, `SDP handling error: ${err}`);
      }
    });

    // ICE relay
    this.signaling.on(
      "ice",
      async (msg: { from: string; candidate: RTCIceCandidateInit }) => {
        await this.webrtc.addRemoteCandidate(msg.from, msg.candidate.candidate!, msg.candidate.sdpMid ?? "0");
      },
    );

    // Room events
    this.signaling.on("room:peer-joined", (msg: { roomId: string; peer: Record<string, unknown> }) => {
      logger.info(MODULE, `Peer joined room ${msg.roomId}: ${(msg.peer as Record<string, unknown>).displayName}`);
      // Initiate WebRTC connection to new peer
    });

    this.signaling.on("room:peer-left", (msg: { roomId: string; peerId: string }) => {
      logger.info(MODULE, `Peer left room ${msg.roomId}: ${msg.peerId}`);
      this.webrtc.disconnect(msg.peerId);
    });
  }

  // Emit wrapper to match ConnectionEvent type
  private emit(event: ConnectionEvent): void {
    super.emit(event.type, event);
  }
}
