// ClawChat — Signal Protocol Encryption Layer (Main Wrapper)
import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, generateKeyPairSync } from "node:crypto";
import { SqliteKeyStore } from "./key-store.ts";
import { SessionManager } from "./session.ts";
import type {
  EncryptionLayer,
  EncryptionStats,
  SignalMessage,
  IdentityKeyPair,
  SessionState,
  ChainState,
  PreKeyBundle,
} from "./types.ts";
import { agentIdFromPublicKey } from "../utils/id.ts";
import { logger } from "../utils/logger.ts";

const MODULE = "signal";
const MESSAGE_KEY_CACHE_SIZE = 2000;

// Message key cache entry for tracking out-of-order messages
interface CachedMessageKey {
  key: Uint8Array;
  peerId: string;
  counter: number;
  timestamp: number;
}

export class SignalEncryption implements EncryptionLayer {
  private keyStore: SqliteKeyStore;
  private sessionManager: SessionManager;
  private identityKeyPair: IdentityKeyPair | null = null;
  private registrationId: number = 0;
  private messageKeyCache: Map<string, CachedMessageKey> = new Map();

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

    const bundle = await this.sessionManager.getPreKeyBundle({
      identityKeyPair: this.identityKeyPair,
      registrationId: this.registrationId,
    });

    // Validate required signed prekey exists
    if (!bundle.signedPreKey) {
      throw new Error("No signed prekey available. Ensure prekeys are generated.");
    }

    // Return bundle with deviceId to match PreKeyBundle interface
    return {
      identityKey: bundle.identityKey,
      registrationId: bundle.registrationId,
      deviceId: 1, // Default device ID
      signedPreKey: bundle.signedPreKey,
      preKey: bundle.preKey ?? undefined,
    };
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

    const sendingChain = session.sendingChain;
    if (!sendingChain) {
      throw new Error(`No sending chain available for ${peerId}`);
    }

    // Get current counter before deriving message key
    const currentCounter = sendingChain.counter;

    // Generate message key from current chain state
    const messageKey = this.deriveMessageKey(sendingChain, currentCounter);

    // Encrypt with AES-256-GCM
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", messageKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // Advance the sending chain after encryption
    const advancedChain = this.advanceChain(sendingChain);

    // Update session with advanced chain
    const updatedSession: SessionState = {
      ...session,
      sendingChain: advancedChain,
      previousCounter: currentCounter,
      lastUsed: Date.now(),
    };
    await this.sessionManager.updateSession(peerId, updatedSession);

    // Pack counter (4 bytes) + iv (12 bytes) + tag (16 bytes) + ciphertext into body
    const counterBuffer = Buffer.alloc(4);
    counterBuffer.writeUInt32BE(currentCounter, 0);

    const body = new Uint8Array(4 + 12 + 16 + encrypted.length);
    body.set(counterBuffer, 0);
    body.set(iv, 4);
    body.set(tag, 16);
    body.set(encrypted, 32);

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

    // Unpack counter (4 bytes) + iv (12 bytes) + tag (16 bytes) + ciphertext from body
    const body = Buffer.from(message.body);
    if (body.length < 32) {
      throw new Error("Invalid message body: too short to contain counter, IV and tag");
    }

    const counter = body.readUInt32BE(0);
    const iv = body.subarray(4, 16);
    const tag = body.subarray(16, 32);
    const ciphertext = body.subarray(32);

    // Find or create receiving chain
    let receivingChain = session.receivingChains[0];
    if (!receivingChain) {
      throw new Error(`No receiving chain available for ${peerId}`);
    }

    // Check for out-of-order message
    if (counter < receivingChain.counter) {
      // Try to find cached message key for out-of-order message
      const cachedKey = this.getMessageKeyFromCache(peerId, counter);
      if (cachedKey) {
        return this.decryptWithKey(cachedKey, iv, tag, ciphertext);
      }
      throw new Error(`Message key for counter ${counter} not found. Possible replay attack.`);
    }

    // Store message keys for skipped messages (for out-of-order handling)
    if (counter > receivingChain.counter) {
      // Derive and cache keys for skipped counters
      let tempChain = { ...receivingChain, messageKeys: new Map(receivingChain.messageKeys) };
      while (tempChain.counter < counter) {
        const skippedKey = this.deriveMessageKey(tempChain, tempChain.counter);
        this.cacheMessageKey(peerId, tempChain.counter, skippedKey);
        tempChain = this.advanceChain(tempChain);
      }
      receivingChain = tempChain;
    }

    // Derive message key for current counter
    const messageKey = this.deriveMessageKey(receivingChain, counter);

    // Decrypt the message
    const decrypted = this.decryptWithKey(messageKey, iv, tag, ciphertext);

    // Advance the receiving chain after successful decryption
    const advancedChain = this.advanceChain(receivingChain);

    // Update session with advanced chain
    const updatedSession: SessionState = {
      ...session,
      receivingChains: [advancedChain, ...session.receivingChains.slice(1)],
      lastUsed: Date.now(),
    };
    await this.sessionManager.updateSession(peerId, updatedSession);

    return decrypted;
  }

  // ─── Session Management ───────────────────────────────────────

  async hasSession(peerId: string): Promise<boolean> {
    const session = await this.sessionManager.getSession(peerId);
    return session !== null;
  }

  async deleteSession(peerId: string): Promise<void> {
    await this.sessionManager.deleteSession(peerId);
    // Clean up cached message keys for this peer
    for (const [key, value] of this.messageKeyCache.entries()) {
      if (value.peerId === peerId) {
        this.messageKeyCache.delete(key);
      }
    }
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

  /**
   * Generate an X25519 key pair using Node.js crypto module.
   * This is the proper cryptographic approach for Diffie-Hellman key exchange.
   */
  private generateIdentityKeyPair(): IdentityKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync("x25519");

    // Export keys to raw Buffer format
    const publicKeyBuffer = publicKey.export({ format: "der", type: "spki" });
    const privateKeyBuffer = privateKey.export({ format: "der", type: "pkcs8" });

    // X25519 keys are 32 bytes in the raw format
    // SPKI format: 12 bytes header + 32 bytes key
    // PKCS8 format: 14 bytes header + 32 bytes key
    const publicKeyRaw = publicKeyBuffer.subarray(-32);
    const privateKeyRaw = privateKeyBuffer.subarray(-32);

    return {
      publicKey: new Uint8Array(publicKeyRaw),
      privateKey: new Uint8Array(privateKeyRaw),
    };
  }

  /**
   * Derive a message key from the current chain state.
   * Does NOT advance the chain - use advanceChain for that.
   */
  private deriveMessageKey(chain: ChainState, counter: number): Buffer {
    if (!chain.chainKey) {
      throw new Error("No chain key available for message key derivation");
    }

    // HKDF-like derivation: HMAC-SHA256(chainKey, "message-key" || counter)
    const hmac = createHmac("sha256", Buffer.from(chain.chainKey));
    hmac.update(Buffer.from("message-key"));
    hmac.update(Buffer.from([counter >> 24, counter >> 16, counter >> 8, counter & 0xff]));
    return hmac.digest();
  }

  /**
   * Advance the chain key to the next state.
   * This creates a new chain key using KDF and increments the counter.
   */
  private advanceChain(chain: ChainState): ChainState {
    if (!chain.chainKey) {
      throw new Error("No chain key available for advancement");
    }

    // Derive next chain key: HMAC-SHA256(currentChainKey, "chain-key")
    const nextChainKey = createHmac("sha256", Buffer.from(chain.chainKey))
      .update(Buffer.from("chain-key"))
      .digest();

    return {
      chainKey: new Uint8Array(nextChainKey),
      counter: chain.counter + 1,
      messageKeys: new Map(chain.messageKeys),
    };
  }

  /**
   * Cache a message key for out-of-order message handling.
   * Maintains a bounded cache to prevent memory growth.
   */
  private cacheMessageKey(peerId: string, counter: number, key: Buffer): void {
    const cacheKey = `${peerId}:${counter}`;

    // Enforce cache size limit
    if (this.messageKeyCache.size >= MESSAGE_KEY_CACHE_SIZE) {
      // Remove oldest entries
      const entriesToRemove = Math.floor(MESSAGE_KEY_CACHE_SIZE * 0.2);
      let removed = 0;
      for (const [key] of this.messageKeyCache.entries()) {
        if (removed >= entriesToRemove) break;
        this.messageKeyCache.delete(key);
        removed++;
      }
    }

    this.messageKeyCache.set(cacheKey, {
      key: new Uint8Array(key),
      peerId,
      counter,
      timestamp: Date.now(),
    });
  }

  /**
   * Retrieve a cached message key for out-of-order message decryption.
   */
  private getMessageKeyFromCache(peerId: string, counter: number): Buffer | null {
    const cacheKey = `${peerId}:${counter}`;
    const cached = this.messageKeyCache.get(cacheKey);

    if (cached) {
      // Remove from cache after use (one-time use)
      this.messageKeyCache.delete(cacheKey);
      return Buffer.from(cached.key);
    }

    return null;
  }

  /**
   * Decrypt ciphertext using AES-256-GCM with the provided key.
   */
  private decryptWithKey(
    key: Buffer,
    iv: Buffer,
    tag: Buffer,
    ciphertext: Buffer,
  ): Uint8Array {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return new Uint8Array(decrypted);
  }

  private getFingerprint(publicKey: Uint8Array): string {
    const hash = createHash("sha256").update(publicKey).digest("hex");
    // Format as 8 groups of 4 characters
    return hash
      .slice(0, 32)
      .match(/.{4}/g)!
      .join(":");
  }

  // ─── Cleanup ──────────────────────────────────────────────

  async close(): Promise<void> {
    this.keyStore.close();
    this.messageKeyCache.clear();
    logger.info(MODULE, "Encryption layer closed");
  }
}

// ─── Re-export types ────────────────────────────────────────────

export type { PreKeyBundle, SignalMessage } from "./types.ts";