// ClawChat — WebRTC DataChannel Manager
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.ts";
import type {
  PeerConnection,
  DataChannelInfo,
  ConnectionStats,
  WebRTCState,
} from "./types.ts";
import { CHANNEL_LABELS, type ChannelLabel } from "./types.ts";

const MODULE = "webrtc";

// ─── Type declarations for node-datachannel ──────────────────────

interface RTCConfiguration {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: "all" | "relay";
}

interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface PeerConnectionInterface {
  state(): string;
  iceConnectionState(): string;
  onLocalDescription(cb: (sdp: string, type: string) => void): void;
  onLocalCandidate(cb: (candidate: string, mid: string) => void): void;
  onDataChannel(cb: (dc: DataChannelInterface) => void): void;
  setRemoteDescription(sdp: string, type: string): void;
  addRemoteCandidate(candidate: string, mid: string): void;
  createDataChannel(label: string, config?: DataChannelConfig): DataChannelInterface;
  close(): void;
}

interface DataChannelInterface {
  label: string;
  isOpen(): boolean;
  bufferedAmount(): number;
  maxRetransmits(): number;
  isOrdered(): boolean;
  sendMessage(msg: string): boolean;
  sendMessageBinary(buffer: Uint8Array): boolean;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  onError(cb: (err: string) => void): void;
  onMessage(cb: (msg: string | Uint8Array) => void): void;
  close(): void;
}

interface DataChannelConfig {
  ordered?: boolean;
  maxRetransmits?: number;
}

interface NodeDataChannelModule {
  initLogger(level: number): void;
  PeerConnection(config: {
    iceServers: string[];
    iceTransportPolicy?: string;
  }): PeerConnectionInterface;
}

// Dynamic import of node-datachannel
let nDC: NodeDataChannelModule | null = null;
async function getNodeDataChannel(): Promise<NodeDataChannelModule> {
  if (!nDC) {
    const mod = await import("node-datachannel");
    nDC = mod as unknown as NodeDataChannelModule;
    nDC.initLogger(process.env.CLAWCHAT_WEBRTC_DEBUG ? 1 : 0);
  }
  return nDC;
}

// ─── WebRTC Connection Manager ──────────────────────────────────

export class WebRTCManager extends EventEmitter {
  private connections = new Map<string, PeerConnectionInterface>();
  private dataChannels = new Map<string, Map<string, DataChannelInterface>>();
  private stats = new Map<string, ConnectionStats>();
  private reconnectAttempts = new Map<string, number>();

  constructor(
    private iceServers: string[] = ["stun:stun.l.google.com:19302"],
    private maxReconnectAttempts: number = 5,
  ) {
    super();
  }

  // ─── Connection Lifecycle ────────────────────────────────────

  async createOffer(peerId: string): Promise<{ sdp: string; type: string }> {
    const nDC = await getNodeDataChannel();
    const pc = nDC.PeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "all",
    });

    this.setupPeerConnection(peerId, pc);
    this.connections.set(peerId, pc);

    // Create data channels
    await this.createDataChannels(peerId, pc);

    // Wait for local description
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out creating offer for ${peerId}`));
      }, 10_000);

      pc.onLocalDescription((sdp, type) => {
        clearTimeout(timeout);
        resolve({ sdp, type });
      });
    });
  }

  async createAnswer(
    peerId: string,
    remoteSdp: string,
    remoteType: string,
  ): Promise<{ sdp: string; type: string }> {
    const nDC = await getNodeDataChannel();
    const pc = nDC.PeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "all",
    });

    this.setupPeerConnection(peerId, pc);
    this.connections.set(peerId, pc);

    // Set remote description and create answer
    pc.setRemoteDescription(remoteSdp, remoteType);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out creating answer for ${peerId}`));
      }, 10_000);

      pc.onLocalDescription((sdp, type) => {
        clearTimeout(timeout);
        resolve({ sdp, type });
      });
    });
  }

  async setRemoteDescription(peerId: string, sdp: string, type: string): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) {
      throw new Error(`No connection for peer ${peerId}`);
    }
    pc.setRemoteDescription(sdp, type);
  }

  async addRemoteCandidate(peerId: string, candidate: string, mid: string): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) {
      logger.warn(MODULE, `No connection for peer ${peerId}, ignoring ICE candidate`);
      return;
    }
    pc.addRemoteCandidate(candidate, mid);
  }

  // ─── Data Channel Operations ─────────────────────────────────

  async send(peerId: string, data: Uint8Array, channel: ChannelLabel = CHANNEL_LABELS.MESSAGE): Promise<void> {
    const channels = this.dataChannels.get(peerId);
    if (!channels) {
      throw new Error(`No data channels for peer ${peerId}`);
    }

    const dc = channels.get(channel);
    if (!dc || !dc.isOpen()) {
      throw new Error(`Data channel '${channel}' not open for peer ${peerId}`);
    }

    const sent = dc.sendMessageBinary(data);
    if (!sent) {
      throw new Error(`Failed to send message to peer ${peerId}`);
    }

    // Update stats
    const peerStats = this.stats.get(peerId);
    if (peerStats) {
      peerStats.bytesSent += data.byteLength;
      peerStats.messagesSent++;
    }
  }

  async broadcast(data: Uint8Array, channel: ChannelLabel = CHANNEL_LABELS.MESSAGE): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const peerId of this.getConnectedPeers()) {
      promises.push(this.send(peerId, data, channel));
    }
    await Promise.allSettled(promises);
  }

  // ─── Peer Management ─────────────────────────────────────────

  getConnectedPeers(): string[] {
    const connected: string[] = [];
    for (const [peerId, pc] of this.connections) {
      if (pc.state() === "connected") {
        connected.push(peerId);
      }
    }
    return connected;
  }

  getConnectionState(peerId: string): WebRTCState {
    const pc = this.connections.get(peerId);
    return (pc?.state() as WebRTCState) ?? "closed";
  }

  getPeerConnection(peerId: string): PeerConnection | null {
    const pc = this.connections.get(peerId);
    if (!pc) return null;

    const channelInfos = new Map<string, DataChannelInfo>();
    const channels = this.dataChannels.get(peerId);
    if (channels) {
      for (const [label, dc] of channels) {
        channelInfos.set(label, {
          label,
          readyState: dc.isOpen() ? "open" : "closed",
          bufferedAmount: dc.bufferedAmount(),
          maxRetransmits: dc.maxRetransmits(),
          ordered: dc.isOrdered(),
        });
      }
    }

    return {
      peerId,
      state: pc.state() as WebRTCState,
      dataChannels: channelInfos,
      iceConnectionState: pc.iceConnectionState(),
      connectedAt: null, // Would track in production
      stats: this.stats.get(peerId) ?? this.createEmptyStats(),
    };
  }

  disconnect(peerId: string): void {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.dataChannels.delete(peerId);
    this.stats.delete(peerId);
    this.reconnectAttempts.delete(peerId);
    logger.info(MODULE, `Disconnected from ${peerId.slice(0, 8)}...`);
  }

  disconnectAll(): void {
    for (const [peerId, pc] of this.connections) {
      pc.close();
    }
    this.connections.clear();
    this.dataChannels.clear();
    this.stats.clear();
    this.reconnectAttempts.clear();
    logger.info(MODULE, "All connections closed");
  }

  // ─── Private Methods ─────────────────────────────────────────

  private setupPeerConnection(peerId: string, pc: PeerConnectionInterface): void {
    pc.onLocalDescription((sdp, type) => {
      this.emit("local-description", { peerId, sdp, type });
    });

    pc.onLocalCandidate((candidate, mid) => {
      this.emit("local-candidate", { peerId, candidate, mid });
    });

    pc.onDataChannel((dc: DataChannelInterface) => {
      this.handleRemoteDataChannel(peerId, dc);
    });

    this.stats.set(peerId, this.createEmptyStats());
  }

  private async createDataChannels(
    peerId: string,
    pc: PeerConnectionInterface,
  ): Promise<void> {
    const channels = new Map<string, DataChannelInterface>();

    // Control channel — reliable, ordered
    const ctrl = pc.createDataChannel(CHANNEL_LABELS.CONTROL, { ordered: true });
    this.setupDataChannel(peerId, CHANNEL_LABELS.CONTROL, ctrl);
    channels.set(CHANNEL_LABELS.CONTROL, ctrl);

    // Message channel — reliable, ordered
    const msg = pc.createDataChannel(CHANNEL_LABELS.MESSAGE, { ordered: true });
    this.setupDataChannel(peerId, CHANNEL_LABELS.MESSAGE, msg);
    channels.set(CHANNEL_LABELS.MESSAGE, msg);

    // Knowledge channel — reliable, ordered
    const kb = pc.createDataChannel(CHANNEL_LABELS.KNOWLEDGE, { ordered: true });
    this.setupDataChannel(peerId, CHANNEL_LABELS.KNOWLEDGE, kb);
    channels.set(CHANNEL_LABELS.KNOWLEDGE, kb);

    this.dataChannels.set(peerId, channels);
  }

  private setupDataChannel(
    peerId: string,
    label: string,
    dc: DataChannelInterface,
  ): void {
    dc.onOpen(() => {
      logger.info(MODULE, `Channel '${label}' opened for ${peerId.slice(0, 8)}...`);
      this.emit("channel-open", { peerId, label });
    });

    dc.onClose(() => {
      logger.info(MODULE, `Channel '${label}' closed for ${peerId.slice(0, 8)}...`);
      this.emit("channel-close", { peerId, label });
    });

    dc.onError((err: string) => {
      logger.error(MODULE, `Channel '${label}' error for ${peerId.slice(0, 8)}...: ${err}`);
      this.emit("channel-error", { peerId, label, error: err });
    });

    dc.onMessage((msg: string | Uint8Array) => {
      const data = typeof msg === "string" ? new TextEncoder().encode(msg) : new Uint8Array(msg);
      
      // Update stats
      const peerStats = this.stats.get(peerId);
      if (peerStats) {
        peerStats.bytesReceived += data.byteLength;
        peerStats.messagesReceived++;
      }

      this.emit("message", { peerId, channel: label, data });
    });
  }

  private handleRemoteDataChannel(peerId: string, dc: DataChannelInterface): void {
    const label = dc.label;
    let channels = this.dataChannels.get(peerId);
    if (!channels) {
      channels = new Map();
      this.dataChannels.set(peerId, channels);
    }
    channels.set(label, dc);
    this.setupDataChannel(peerId, label, dc);
  }

  private createEmptyStats(): ConnectionStats {
    return {
      bytesSent: 0,
      bytesReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
      roundTripTimeMs: null,
      packetsLost: 0,
    };
  }
}
