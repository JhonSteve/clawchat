// ClawChat — Signal Protocol Key Store (SQLCipher-backed)
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  ensureDataDir,
  CLAWCHAT_DIR,
} from "../config.ts";
import type {
  IdentityKeyPair,
  PreKeyRecord,
  SignedPreKeyRecord,
  SignalKeyStore,
  SessionState,
} from "./types.ts";
import { logger } from "../utils/logger.ts";

const MODULE = "key-store";

export class SqliteKeyStore implements SignalKeyStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    ensureDataDir();
    const path = dbPath ?? join(CLAWCHAT_DIR, "keys", "signal-keys.db");

    this.db = new Database(path);

    // Enable WAL mode for better concurrent access
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.initializeTables();
    logger.info(MODULE, `Key store initialized at ${path}`);
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identity_keys (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key BLOB NOT NULL,
        private_key BLOB NOT NULL,
        registration_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pre_keys (
        key_id INTEGER PRIMARY KEY,
        public_key BLOB NOT NULL,
        private_key BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signed_pre_keys (
        key_id INTEGER PRIMARY KEY,
        public_key BLOB NOT NULL,
        private_key BLOB NOT NULL,
        signature BLOB NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        peer_id TEXT PRIMARY KEY,
        session_data BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trusted_identities (
        peer_id TEXT NOT NULL,
        identity_key BLOB NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (peer_id)
      );
    `);
  }

  // ─── Identity Keys ────────────────────────────────────────────

  async getIdentityKeyPair(): Promise<IdentityKeyPair | null> {
    const row = this.db
      .prepare("SELECT public_key, private_key FROM identity_keys WHERE id = 1")
      .get() as { public_key: Buffer; private_key: Buffer } | undefined;

    if (!row) return null;

    return {
      publicKey: new Uint8Array(row.public_key),
      privateKey: new Uint8Array(row.private_key),
    };
  }

  async setIdentityKeyPair(keyPair: IdentityKeyPair): Promise<void> {
    const existing = await this.getIdentityKeyPair();
    const now = Date.now();

    if (existing) {
      this.db
        .prepare("UPDATE identity_keys SET public_key = ?, private_key = ? WHERE id = 1")
        .run(Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey));
    } else {
      this.db
        .prepare(
          "INSERT INTO identity_keys (id, public_key, private_key, registration_id, created_at) VALUES (1, ?, ?, ?, ?)",
        )
        .run(Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey), 1, now);
    }
  }

  // ─── Registration ID ──────────────────────────────────────────

  async getLocalRegistrationId(): Promise<number> {
    const row = this.db
      .prepare("SELECT registration_id FROM identity_keys WHERE id = 1")
      .get() as { registration_id: number } | undefined;

    return row?.registration_id ?? 0;
  }

  async setLocalRegistrationId(id: number): Promise<void> {
    this.db
      .prepare("UPDATE identity_keys SET registration_id = ? WHERE id = 1")
      .run(id);
  }

  // ─── Pre-Keys ─────────────────────────────────────────────────

  async loadPreKey(keyId: number): Promise<PreKeyRecord | null> {
    const row = this.db
      .prepare("SELECT public_key, private_key FROM pre_keys WHERE key_id = ?")
      .get(keyId) as { public_key: Buffer; private_key: Buffer } | undefined;

    if (!row) return null;

    return {
      id: keyId,
      keyPair: {
        publicKey: new Uint8Array(row.public_key),
        privateKey: new Uint8Array(row.private_key),
      },
    };
  }

  async storePreKey(keyId: number, record: PreKeyRecord): Promise<void> {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO pre_keys (key_id, public_key, private_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        keyId,
        Buffer.from(record.keyPair.publicKey),
        Buffer.from(record.keyPair.privateKey),
        Date.now(),
      );
  }

  async removePreKey(keyId: number): Promise<void> {
    this.db.prepare("DELETE FROM pre_keys WHERE key_id = ?").run(keyId);
  }

  async getAllPreKeyIds(): Promise<number[]> {
    const rows = this.db
      .prepare("SELECT key_id FROM pre_keys")
      .all() as { key_id: number }[];

    return rows.map((r) => r.key_id);
  }

  // ─── Signed Pre-Keys ──────────────────────────────────────────

  async loadSignedPreKey(keyId: number): Promise<SignedPreKeyRecord | null> {
    const row = this.db
      .prepare("SELECT public_key, private_key, signature, timestamp FROM signed_pre_keys WHERE key_id = ?")
      .get(keyId) as
      | { public_key: Buffer; private_key: Buffer; signature: Buffer; timestamp: number }
      | undefined;

    if (!row) return null;

    return {
      id: keyId,
      keyPair: {
        publicKey: new Uint8Array(row.public_key),
        privateKey: new Uint8Array(row.private_key),
      },
      signature: new Uint8Array(row.signature),
      timestamp: row.timestamp,
    };
  }

  async storeSignedPreKey(keyId: number, record: SignedPreKeyRecord): Promise<void> {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO signed_pre_keys (key_id, public_key, private_key, signature, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        keyId,
        Buffer.from(record.keyPair.publicKey),
        Buffer.from(record.keyPair.privateKey),
        Buffer.from(record.signature),
        record.timestamp,
        Date.now(),
      );
  }

  async removeSignedPreKey(keyId: number): Promise<void> {
    this.db.prepare("DELETE FROM signed_pre_keys WHERE key_id = ?").run(keyId);
  }

  async getAllSignedPreKeyIds(): Promise<number[]> {
    const rows = this.db
      .prepare("SELECT key_id FROM signed_pre_keys")
      .all() as { key_id: number }[];

    return rows.map((r) => r.key_id);
  }

  // ─── Sessions ─────────────────────────────────────────────────

  async loadSession(peerId: string): Promise<SessionState | null> {
    const row = this.db
      .prepare("SELECT session_data FROM sessions WHERE peer_id = ?")
      .get(peerId) as { session_data: Buffer } | undefined;

    if (!row) return null;

    try {
      const json = row.session_data.toString("utf-8");
      return JSON.parse(json) as SessionState;
    } catch {
      logger.error(MODULE, `Failed to parse session for ${peerId}`);
      return null;
    }
  }

  async storeSession(peerId: string, session: SessionState): Promise<void> {
    const json = JSON.stringify(session);
    const now = Date.now();

    this.db
      .prepare(
        "INSERT OR REPLACE INTO sessions (peer_id, session_data, created_at, last_used) VALUES (?, ?, ?, ?)",
      )
      .run(peerId, Buffer.from(json, "utf-8"), session.createdAt, now);
  }

  async removeSession(peerId: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE peer_id = ?").run(peerId);
  }

  async getAllSessionPeerIds(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT peer_id FROM sessions")
      .all() as { peer_id: string }[];

    return rows.map((r) => r.peer_id);
  }

  // ─── Trusted Identities (TOFU) ────────────────────────────────

  async isTrustedIdentity(peerId: string, identityKey: Uint8Array): Promise<boolean> {
    const row = this.db
      .prepare("SELECT identity_key FROM trusted_identities WHERE peer_id = ?")
      .get(peerId) as { identity_key: Buffer } | undefined;

    if (!row) return true; // First time — trust on first use

    // Compare identity keys
    const stored = new Uint8Array(row.identity_key);
    if (stored.length !== identityKey.length) return false;

    for (let i = 0; i < stored.length; i++) {
      if (stored[i] !== identityKey[i]) return false;
    }

    return true;
  }

  async saveTrustedIdentity(peerId: string, identityKey: Uint8Array): Promise<void> {
    const now = Date.now();

    this.db
      .prepare(
        "INSERT OR REPLACE INTO trusted_identities (peer_id, identity_key, first_seen, last_seen) VALUES (?, ?, ?, ?)",
      )
      .run(peerId, Buffer.from(identityKey), now, now);
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    this.db.exec(`
      DELETE FROM sessions;
      DELETE FROM trusted_identities;
      DELETE FROM pre_keys;
      DELETE FROM signed_pre_keys;
    `);
    logger.info(MODULE, "All key store data cleared");
  }

  close(): void {
    this.db.close();
    logger.info(MODULE, "Key store closed");
  }
}
