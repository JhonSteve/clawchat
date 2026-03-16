// ClawChat — Signal Protocol Encryption Layer (Main Wrapper)
import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { SqliteKeyStore } from "./key-store.ts";
import { SessionManager } from "./session.ts";
import type {
  EncryptionLayer,
  EncryptionStats,
  SignalMessage,
  IdentityKeyPair,
} from "./types.ts";
import { agentIdFromPublicKey } from "../utils/id.ts";
import { logger } from "../utils/logger.ts";

const MODULE = "signal";
const MESSAGE_KEY_CACHE_SIZE = 2000;

export class SignalEncryption implements EncryptionLayer {
  private keyStore: SqliteKeyStore;
  private sessionManager: SessionManager;
  private identityKeyPair: IdentityKeyPair | null = null;
  private registrationId: number = 0;

  constructor(dbPath?: string) {
    this.keyStore = new SqliteKeyStore(dbPath);
    this.sessionManager = new SessionManager(this.keyStore);
  }

  // ─── Initialization ───────────────────────────────────────────

  async initialize(): Promise<void> {
    // Load or create identity key pair
    this.identityKeyPair = await this.keyStore.getIdentityKeyPair();

    if (!this.identityKeyPair) {
      this.identityKeyPair = this.generateIdentityKeyPair();
      await this.keyStore.setIdentityKeyPair(this.identityKeyPair);
      logger.info(MODULE, "New identity key pair generated");
    }

    // Load or create registration ID
    this.registrationId = await this.keyStore.getLocalRegistrationId();
    if (this.registrationId === 0) {
      this.registrationId = Math.floor(Math.random() * 16383) + 1;
      await this.keyStore.setLocalRegistrationId(this.registrationId);
    }

    // Ensure sufficient pre-keys
    await this.sessionManager.ensurePreKeys(100);

    const fingerprint = this.getFingerprint(this.identityKeyPair.publicKey);
    logger.info(MODULE, `Identity initialized: ${fingerprint}`);
  }

  // ─── Identity ─────────────────────────────────────────────────

  getIdentity(): IdentityKeyPair {
    if (!this.identityKeyPair) {
      throw new Error("SignalEncryption not initialized. Call initialize() first.");
    }
    return this.identityKeyPair;
  }

  getAgentId(): string {
    if (!this.identityKeyPair) {
      throw new Error("SignalEncryption not initialized.");
    }
    return agentIdFromPublicKey(this.identityKeyPair.publicKey);
  }

  // ─── Pre-Key Bundle ───────────────────────────────────────────

  async getPreKeyBundle(): Promise<PreKeyBundle> {
    if (!this.identityKeyPair) {
      throw new Error("SignalEncryption not initialized.");
    }

    return this.sessionManager.getPreKeyBundle({
      identityKeyPair: this.identityKeyPair,
      registrationId: this.registrationId,
    });
  }

  // ─── Session Establishment ────────────────────────────────────

  async processPreKeyBundle(peerId: string, bundle: PreKeyBundle): Promise<void> {
    // Verify peer's identity key is trusted
    const isTrusted = await this.keyStore.isTrustedIdentity(
      peerId,
      bundle.identityKey,
    );

    if (!isTrusted) {
      logger.warn(MODULE, `Identity key changed for ${peerId.slice(0, 8)}... — TOFU violation`);
      throw new Error(`Identity key changed for ${peerId}. Possible MITM attack.`);
    }

    // Create session with the peer
    await this.sessionManager.createSession(peerId, {
      remoteIdentityKey: bundle.identityKey,
      localRegistrationId: this.registrationId,
      remoteRegistrationId: bundle.registrationId,
      pendingPreKey: bundle.preKey
        ? {
            preKeyId: bundle.preKey.keyId,
            signedPreKeyId: bundle.signedPreKey?.keyId ?? 0,
            baseKey: randomBytes(32), // Ephemeral base key
          }
        : undefined,
    });

    // Save trusted identity
    await this.keyStore.saveTrustedIdentity(peerId, bundle.identityKey);

    logger.info(MODULE, `Session established with ${peerId.slice(0, 8)}...`);
  }

  // ─── Encrypt / Decrypt ────────────────────────────────────────

  async encrypt(peerId: string, plaintext: Uint8Array): Promise<SignalMessage> {
    const session = await this.sessionManager.getSession(peerId);
    if (!session) {
      throw new Error(`No session with ${peerId}. Establish session first.`);
    }

    // Generate message key from chain
    const messageKey = this.deriveMessageKey(session, "send");
    
    // Encrypt with AES-256-GCM
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", messageKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // Update session
    await this.sessionManager.updateSession(peerId, {
      previousCounter: session.sendingChain?.counter ?? 0,
    });

    // Pack iv (12 bytes) + tag (16 bytes) + ciphertext into body
    const body = new Uint8Array(12 + 16 + encrypted.length);
    body.set(iv, 0);
    body.set(tag, 12);
    body.set(encrypted, 28);

    return {
      type: "message",
      body,
      registrationId: this.registrationId,
    };
  }

  async decrypt(peerId: string, message: SignalMessage): Promise<Uint8Array> {
    const session = await this.sessionManager.getSession(peerId);
    if (!session) {
      throw new Error(`No session with ${peerId}. Cannot decrypt.`);
    }

    // Derive message key
    const messageKey = this.deriveMessageKey(session, "receive");

    // Unpack iv (12 bytes) + tag (16 bytes) + ciphertext from body
    const body = Buffer.from(message.body);
    if (body.length < 28) {
      throw new Error("Invalid message body: too short to contain IV and tag");
    }
    const iv = body.subarray(0, 12);
    const tag = body.subarray(12, 28);
    const ciphertext = body.subarray(28);

    // Decrypt with AES-256-GCM
    const decipher = createDecipheriv("aes-256-gcm", messageKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return new Uint8Array(decrypted);
  }

  // ─── Session Management ───────────────────────────────────────

  async hasSession(peerId: string): Promise<boolean> {
    const session = await this.sessionManager.getSession(peerId);
    return session !== null;
  }

  async deleteSession(peerId: string): Promise<void> {
    await this.sessionManager.deleteSession(peerId);
  }

  // ─── Statistics ───────────────────────────────────────────────

  getStats(): EncryptionStats {
    const identityKey = this.identityKeyPair?.publicKey;
    return {
      identityKeyFingerprint: identityKey
        ? this.getFingerprint(identityKey)
        : "not-initialized",
      registrationId: this.registrationId,
      activeSessions: 0, // Would need async query
      totalPreKeys: 0,
      totalSignedPreKeys: 0,
    };
  }

  // ─── Private Methods ──────────────────────────────────────────

  private generateIdentityKeyPair(): IdentityKeyPair {
    const privateKey = randomBytes(32);
    const publicKey = createHash("sha256")
      .update(privateKey)
      .update(Buffer.from("identity-public"))
      .digest();

    return {
      publicKey: new Uint8Array(publicKey),
      privateKey: new Uint8Array(privateKey),
    };
  }

  private deriveMessageKey(
    session: SessionState,
    direction: "send" | "receive",
    counter?: number,
  ): Buffer {
    const chainKey = direction === "send"
      ? session.sendingChain?.chainKey
      : session.receivingChains[0]?.chainKey;

    if (!chainKey) {
      throw new Error(`No chain key available for ${direction}`);
    }

    // HKDF-like derivation
    const hmac = createHmac("sha256", Buffer.from(chainKey));
    hmac.update(Buffer.from("message-key"));
    if (counter !== undefined) {
      hmac.update(Buffer.from(counter.toString()));
    }
    return hmac.digest();
  }

  private getFingerprint(publicKey: Uint8Array): string {
    const hash = createHash("sha256").update(publicKey).digest("hex");
    // Format as 8 groups of 4 characters
    return hash
      .slice(0, 32)
      .match(/.{4}/g)!
      .join(":");
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async close(): Promise<void> {
    this.keyStore.close();
    logger.info(MODULE, "Encryption layer closed");
  }
}

// ─── Re-export types ────────────────────────────────────────────

import type { PreKeyBundleResult as PreKeyBundle, SignalMessage, SessionState } from "./types.ts";
export type { PreKeyBundle, SignalMessage };
