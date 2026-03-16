// ClawChat Signaling Service — Module Exports
// Integrated signaling service for the OpenClaw plugin

export {
  createSignalingService,
  DEFAULT_SIGNALING_CONFIG,
  RoomManager,
  PeerManager,
  SignalingHandler,
} from "./service.ts";

export type {
  SignalingService,
  SignalingServiceOptions,
} from "./service.ts";

export type {
  SignalingServiceConfig,
  SignalingServiceState,
  SignalingMessage,
  SignalingResponse,
  PeerInfo,
  PeerMetadata,
  Room,
  RoomMetadata,
  RoomSummary,
  Invitation,
  ConnectMessage,
  DisconnectMessage,
  HeartbeatMessage,
  RoomCreateMessage,
  RoomJoinMessage,
  RoomLeaveMessage,
  RoomListMessage,
  InviteCreateMessage,
  InviteRedeemMessage,
  SDPMessage,
  ICEMessage,
  ErrorMessage,
} from "./types.ts";