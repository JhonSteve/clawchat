// ClawChat — Protocol Type Definitions

// ─── Agent Identity ──────────────────────────────────────────────

export interface AgentIdentity {
  agentId: string;
  displayName: string;
  publicKeyFingerprint: string;
  registrationId: number;
}

// ─── Peer Info ───────────────────────────────────────────────────

export interface PeerInfo {
  agentId: string;
  displayName: string;
  version: string;
  profile: AgentProfile;
  connectionState: ConnectionState;
  connectedAt: number | null;
  lastSeen: number | null;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "handshaking"
  | "connected"
  | "error";

// ─── Agent Profile ───────────────────────────────────────────────

export interface AgentProfile {
  agentId: string;
  displayName: string;
  version: string;
  tags: AgentTag[];
  totalTokensUsed: number;
  uptime: string;
  peerCount: number;
  availability: Availability;
  capabilities: string[];
  lastUpdated: number;
}

export interface AgentTag {
  category: string;
  specialty: string;
  confidence: number;
  evidence: string[];
}

export type Availability = "online" | "busy" | "away" | "dnd";

// ─── Message Envelope ────────────────────────────────────────────

export interface ClawEnvelope {
  version: 1;
  id: string;
  from: string;
  to: string | string[];
  timestamp: number;
  type: MessageType;
  payload: unknown;
  replyTo?: string;
  seq?: number;
}

export type MessageType =
  | "profile"
  | "chat"
  | "task"
  | "task-result"
  | "query"
  | "query-result"
  | "knowledge"
  | "kb-query"
  | "kb-result"
  | "control"
  | "group-invite"
  | "error";

// ─── Chat Messages ───────────────────────────────────────────────

export interface ChatPayload {
  content: string;
  format: "text" | "markdown" | "code";
  context?: string;
}

// ─── Task Delegation ─────────────────────────────────────────────

export interface TaskDelegation {
  taskId: string;
  title: string;
  description: string;
  context: string;
  constraints: TaskConstraints;
  priority: TaskPriority;
  attachments?: string[];
}

export interface TaskConstraints {
  maxTokens?: number;
  deadline?: number;
  requiredTags?: string[];
}

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result: string;
  tokensUsed: number;
  duration: number;
  artifacts?: string[];
}

export type TaskStatus = "completed" | "failed" | "partial";

// ─── Knowledge Base ──────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: KnowledgeMetadata;
  signature?: string;
}

export interface KnowledgeMetadata {
  source: string;
  category: string;
  tags: string[];
  created: number;
  updated: number;
  accessLevel: AccessLevel;
  allowedPeers?: string[];
}

export type AccessLevel = "private" | "shared" | "public";

// ─── Control Messages ────────────────────────────────────────────

export interface ControlPayload {
  action: ControlAction;
  data?: unknown;
}

export type ControlAction =
  | "handshake-init"
  | "handshake-accept"
  | "handshake-complete"
  | "ping"
  | "pong"
  | "ack"
  | "error"
  | "group-create"
  | "group-join"
  | "group-leave"
  | "group-invite";

// ─── Group Management ────────────────────────────────────────────

export interface GroupInfo {
  id: string;
  name: string;
  creator: string;
  members: string[];
  createdAt: number;
}

export interface GroupInvitePayload {
  groupId: string;
  groupName: string;
  inviterId: string;
  inviteCode: string;
}

// ─── Query/Consultation ──────────────────────────────────────────

export interface QueryPayload {
  queryId: string;
  question: string;
  context: string;
  requiredExpertise?: string[];
  maxTokens?: number;
}

export interface QueryResultPayload {
  queryId: string;
  answer: string;
  confidence: number;
  tokensUsed: number;
  sources?: string[];
}
