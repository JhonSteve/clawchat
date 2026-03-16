// ClawChat — Knowledge Store (Encrypted Local Storage)
import Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";
import { join } from "node:path";
import { ensureDataDir, CLAWCHAT_DIR } from "../config.ts";
import { encryptAES256GCM, decryptAES256GCM, generateAESKey, type EncryptedData } from "../utils/crypto.ts";
import { generateId } from "../utils/id.ts";
import { logger } from "../utils/logger.ts";
import type { KnowledgeEntry, KnowledgeMetadata, KnowledgeStats, AccessLevel } from "./types.ts";

const MODULE = "knowledge-store";

export class KnowledgeStore {
  private db: Database.Database;
  private encryptionKey: Buffer;

  constructor(dbPath?: string, encryptionKey?: Buffer) {
    ensureDataDir();
    const path = dbPath ?? join(CLAWCHAT_DIR, "knowledge", "clawchat-kb.db");
    this.encryptionKey = encryptionKey ?? generateAESKey();

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.initializeTables();

    logger.info(MODULE, `Knowledge store initialized at ${path}`);
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        encrypted_content BLOB NOT NULL,
        source TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        tags TEXT NOT NULL DEFAULT '[]',
        access_level TEXT NOT NULL DEFAULT 'private',
        allowed_peers TEXT DEFAULT '[]',
        embedding BLOB,
        signature TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_entries(source);
      CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_entries(category);
      CREATE INDEX IF NOT EXISTS idx_knowledge_access ON knowledge_entries(access_level);
      CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_entries(updated_at);
    `);
  }

  // ─── CRUD Operations ──────────────────────────────────────────

  addEntry(
    content: string,
    metadata: Omit<KnowledgeMetadata, "created" | "updated">,
    embedding?: number[],
  ): KnowledgeEntry {
    const id = generateId("kb");
    const now = Date.now();

    const encryptedContent = encryptAES256GCM(content, this.encryptionKey);

    this.db
      .prepare(
        `INSERT INTO knowledge_entries 
         (id, encrypted_content, source, category, tags, access_level, allowed_peers, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        JSON.stringify(encryptedContent),
        metadata.source,
        metadata.category,
        JSON.stringify(metadata.tags),
        metadata.accessLevel,
        JSON.stringify(metadata.allowedPeers ?? []),
        embedding ? Buffer.from(new Float32Array(embedding).buffer) : null,
        now,
        now,
      );

    logger.debug(MODULE, `Entry added: ${id} (${metadata.category})`);

    return {
      id,
      content, // Return plaintext for immediate use
      embedding,
      metadata: {
        ...metadata,
        created: now,
        updated: now,
      },
    };
  }

  getEntry(id: string, includeContent: boolean = true): KnowledgeEntry | null {
    const row = this.db
      .prepare("SELECT * FROM knowledge_entries WHERE id = ?")
      .get(id) as DBRow | undefined;

    if (!row) return null;

    let content = "";
    if (includeContent) {
      try {
        const encryptedData = JSON.parse(row.encrypted_content) as EncryptedData;
        const decrypted = decryptAES256GCM(encryptedData, this.encryptionKey);
        content = decrypted.toString("utf-8");
      } catch (err) {
        logger.error(MODULE, `Failed to decrypt entry ${id}: ${err}`);
        return null;
      }
    }

    let embedding: number[] | undefined;
    if (row.embedding) {
      const buffer = Buffer.from(row.embedding);
      const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
      embedding = [...float32];
    }

    return {
      id: row.id,
      content,
      embedding,
      metadata: {
        source: row.source,
        category: row.category,
        tags: JSON.parse(row.tags) as string[],
        created: row.created_at,
        updated: row.updated_at,
        accessLevel: row.access_level as AccessLevel,
        allowedPeers: JSON.parse(row.allowed_peers) as string[],
      },
      signature: row.signature ?? undefined,
    };
  }

  updateEntry(id: string, content: string, tags?: string[]): KnowledgeEntry | null {
    const existing = this.getEntry(id, false);
    if (!existing) return null;

    const encryptedContent = encryptAES256GCM(content, this.encryptionKey);
    const now = Date.now();

    this.db
      .prepare(
        `UPDATE knowledge_entries 
         SET encrypted_content = ?, tags = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(encryptedContent),
        JSON.stringify(tags ?? existing.metadata.tags),
        now,
        id,
      );

    return {
      ...existing,
      content,
      metadata: {
        ...existing.metadata,
        tags: tags ?? existing.metadata.tags,
        updated: now,
      },
    };
  }

  deleteEntry(id: string): boolean {
    const result = this.db.prepare("DELETE FROM knowledge_entries WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ─── Query Operations ─────────────────────────────────────────

  queryEntries(params: {
    category?: string;
    tags?: string[];
    accessLevel?: AccessLevel;
    source?: string;
    limit?: number;
  }): KnowledgeEntry[] {
    let sql = "SELECT id, source, category, tags, access_level, allowed_peers, created_at, updated_at, signature FROM knowledge_entries WHERE 1=1";
    const args: unknown[] = [];

    if (params.category) {
      sql += " AND category = ?";
      args.push(params.category);
    }

    if (params.source) {
      sql += " AND source = ?";
      args.push(params.source);
    }

    if (params.accessLevel) {
      sql += " AND access_level = ?";
      args.push(params.accessLevel);
    }

    if (params.tags && params.tags.length > 0) {
      // JSON array contains any of the tags
      for (const tag of params.tags) {
        sql += " AND tags LIKE ?";
        args.push(`%"${tag}"%`);
      }
    }

    sql += " ORDER BY updated_at DESC";

    if (params.limit) {
      sql += " LIMIT ?";
      args.push(params.limit);
    }

    const rows = this.db.prepare(sql).all(...args) as DBRow[];

    return rows.map((row) => ({
      id: row.id,
      content: "", // Content not loaded for listing
      metadata: {
        source: row.source,
        category: row.category,
        tags: JSON.parse(row.tags) as string[],
        created: row.created_at,
        updated: row.updated_at,
        accessLevel: row.access_level as AccessLevel,
        allowedPeers: JSON.parse(row.allowed_peers) as string[],
      },
      signature: row.signature ?? undefined,
    }));
  }

  // ─── Vector Search (placeholder — requires embedding model) ──

  async searchSimilar(
    query: string,
    embedding: number[],
    limit: number = 10,
  ): Promise<Array<{ entry: KnowledgeEntry; score: number }>> {
    // This is a placeholder for semantic search
    // In production, this would use LanceDB's vector search
    // For now, fall back to keyword search
    const results: Array<{ entry: KnowledgeEntry; score: number }> = [];

    const rows = this.db
      .prepare("SELECT id FROM knowledge_entries ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as { id: string }[];

    for (const row of rows) {
      const entry = this.getEntry(row.id, true);
      if (entry) {
        // Simple keyword matching as placeholder
        const score = this.keywordScore(query, entry.content);
        if (score > 0) {
          results.push({ entry, score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private keywordScore(query: string, content: string): number {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) matches++;
    }

    return matches / queryWords.length;
  }

  // ─── Statistics ───────────────────────────────────────────────

  getStats(): KnowledgeStats {
    const totalRow = this.db
      .prepare("SELECT COUNT(*) as count FROM knowledge_entries")
      .get() as { count: number };

    const byAccessLevel = this.db
      .prepare("SELECT access_level, COUNT(*) as count FROM knowledge_entries GROUP BY access_level")
      .all() as Array<{ access_level: string; count: number }>;

    const byCategory = this.db
      .prepare("SELECT category, COUNT(*) as count FROM knowledge_entries GROUP BY category")
      .all() as Array<{ category: string; count: number }>;

    const accessLevelStats: Record<string, number> = {};
    for (const row of byAccessLevel) {
      accessLevelStats[row.access_level] = row.count;
    }

    const categoryStats: Record<string, number> = {};
    for (const row of byCategory) {
      categoryStats[row.category] = row.count;
    }

    return {
      totalEntries: totalRow.count,
      byAccessLevel: accessLevelStats as Record<AccessLevel, number>,
      byCategory: categoryStats,
      totalSize: 0, // Would need to calculate from encrypted content
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  clearAll(): void {
    this.db.exec("DELETE FROM knowledge_entries");
    logger.info(MODULE, "All knowledge entries cleared");
  }

  close(): void {
    this.db.close();
    logger.info(MODULE, "Knowledge store closed");
  }
}

// ─── Types ──────────────────────────────────────────────────────

interface DBRow {
  id: string;
  encrypted_content: string;
  source: string;
  category: string;
  tags: string;
  access_level: string;
  allowed_peers: string;
  embedding: Buffer | null;
  signature: string | null;
  created_at: number;
  updated_at: number;
}
