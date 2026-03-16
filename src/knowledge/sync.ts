// ClawChat — P2P Knowledge Synchronization
import { createHash } from "node:crypto";
import { logger } from "../utils/logger.ts";
import type {
  KnowledgeSyncRequest,
  KnowledgeSyncResponse,
  SyncState,
  KnowledgeEntry,
} from "./types.ts";

const MODULE = "kb-sync";

export class KnowledgeSync {
  private syncStates = new Map<string, SyncState>();
  private outgoingQueue = new Map<string, KnowledgeEntry[]>();

  // ─── Sync Request Generation ─────────────────────────────────

  createSyncRequest(peerId: string, params?: {
    categories?: string[];
    accessLevels?: string[];
  }): KnowledgeSyncRequest {
    const state = this.syncStates.get(peerId);

    return {
      peerId,
      since: state?.lastSyncTime ?? 0,
      categories: params?.categories,
      accessLevels: params?.accessLevels as ("private" | "shared" | "public")[] | undefined,
    };
  }

  // ─── Sync Response Processing ────────────────────────────────

  processSyncResponse(peerId: string, response: KnowledgeSyncResponse): void {
    // Update sync state
    const hash = this.computeHash(response.entries);

    this.syncStates.set(peerId, {
      peerId,
      lastSyncTime: response.lastSyncTime,
      lastSyncHash: hash,
      entriesSynced: response.totalSynced,
    });

    logger.info(
      MODULE,
      `Synced ${response.totalSynced} entries from ${peerId.slice(0, 8)}...`,
    );
  }

  // ─── Outgoing Sync Queue ─────────────────────────────────────

  queueEntries(peerId: string, entries: KnowledgeEntry[]): void {
    const existing = this.outgoingQueue.get(peerId) ?? [];
    existing.push(...entries);
    this.outgoingQueue.set(peerId, existing);
  }

  drainQueue(peerId: string): KnowledgeEntry[] {
    const entries = this.outgoingQueue.get(peerId) ?? [];
    this.outgoingQueue.delete(peerId);
    return entries;
  }

  // ─── Sync State ──────────────────────────────────────────────

  getSyncState(peerId: string): SyncState | undefined {
    return this.syncStates.get(peerId);
  }

  getAllSyncStates(): SyncState[] {
    return [...this.syncStates.values()];
  }

  needsSync(peerId: string, lastUpdateTime: number): boolean {
    const state = this.syncStates.get(peerId);
    if (!state) return true;
    return lastUpdateTime > state.lastSyncTime;
  }

  // ─── Hash Computation ────────────────────────────────────────

  private computeHash(entries: KnowledgeEntry[]): string {
    const content = entries
      .map((e) => `${e.id}:${e.metadata.updated}`)
      .sort()
      .join("|");

    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  // ─── Stats ────────────────────────────────────────────────────

  getStats() {
    return {
      trackedPeers: this.syncStates.size,
      totalSynced: [...this.syncStates.values()].reduce((sum, s) => sum + s.entriesSynced, 0),
      queuedEntries: [...this.outgoingQueue.values()].reduce((sum, q) => sum + q.length, 0),
    };
  }
}
