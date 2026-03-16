// ClawChat — Knowledge Base Type Definitions

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

export interface KnowledgeQuery {
  query: string;
  embedding?: number[];
  limit?: number;
  threshold?: number;
  category?: string;
  tags?: string[];
  accessLevel?: AccessLevel;
}

export interface KnowledgeResult {
  entry: KnowledgeEntry;
  score: number;
  distance: number;
}

export interface KnowledgeStats {
  totalEntries: number;
  byAccessLevel: Record<AccessLevel, number>;
  byCategory: Record<string, number>;
  totalSize: number;
}

// ─── Sync Protocol ──────────────────────────────────────────────

export interface KnowledgeSyncRequest {
  peerId: string;
  since: number;
  categories?: string[];
  accessLevels?: AccessLevel[];
}

export interface KnowledgeSyncResponse {
  entries: KnowledgeEntry[];
  totalSynced: number;
  lastSyncTime: number;
}

export interface SyncState {
  peerId: string;
  lastSyncTime: number;
  lastSyncHash: string;
  entriesSynced: number;
}
