// ClawChat — Signal Protocol Session Management
import { randomBytes, createHash } from "node:crypto";
import type {
  SessionState,
  ChainState,
  SignalKeyStore,
  PreKeyRecord,
  SignedPreKeyRecord,
} from "./types.ts";
import { logger } from "../utils/logger.ts";

const MODULE = "session";
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class SessionManager {
  constructor(private keyStore: SignalKeyStore) {}

  // ─── Session Lifecycle ────────────────────────────────────────

  async hasSession(peerId: string): Promise<boolean> {
    const session = await this.keyStore.loadSession(peerId);
    return session !== null;
  }

  async getSession(peerId: string): Promise<SessionState | null> {
    return this.keyStore.loadSession(peerId);
  }

  async createSession(peerId: string, params: CreateSessionParams): Promise<SessionState> {
    const now = Date.now();

    const session: SessionState = {
      peerId,
      sessionVersion: 3,
      remoteIdentityKey: params.remoteIdentityKey,
      localRegistrationId: params.localRegistrationId,
      remoteRegistrationId: params.remoteRegistrationId ?? 0,
      rootKey: params.rootKey ? Buffer.from(params.rootKey) : null,
      sendingChain: null,
      receivingChains: [],
      pendingPreKey: params.pendingPreKey
        ? {
            preKeyId: params.pendingPreKey.preKeyId,
            signedPreKeyId: params.pendingPreKey.signedPreKeyId,
            baseKey: Buffer.from(params.pendingPreKey.baseKey),
          }
        : null,
      previousCounter: 0,
      createdAt: now,
      lastUsed: now,
    };

    await this.keyStore.storeSession(peerId, session);
    logger.debug(MODULE, `Session created for ${peerId.slice(0, 8)}...`);
    return session;
  }

  async updateSession(peerId: string, updates: Partial<SessionState>): Promise<void> {
    const session = await this.keyStore.loadSession(peerId);
    if (!session) {
      throw new Error(`No session found for ${peerId}`);
    }

    const updated: SessionState = {
      ...session,
      ...updates,
      peerId: session.peerId, // Prevent changing peerId
      lastUsed: Date.now(),
    };

    await this.keyStore.storeSession(peerId, updated);
  }

  async deleteSession(peerId: string): Promise<void> {
    await this.keyStore.removeSession(peerId);
    logger.debug(MODULE, `Session deleted for ${peerId.slice(0, 8)}...`);
  }

  // ─── Pre-Key Management ───────────────────────────────────────

  async ensurePreKeys(count: number = 100): Promise<void> {
    const existing = await this.keyStore.getAllPreKeyIds();
    if (existing.length >= count / 2) return; // Replenish at half

    const needed = count - existing.length;
    logger.info(MODULE, `Generating ${needed} new pre-keys...`);

    for (let i = 0; i < needed; i++) {
      const keyId = existing.length > 0 ? Math.max(...existing) + i + 1 : i + 1;
      const keyPair = this.generateKeyPair();
      
      const record: PreKeyRecord = {
        id: keyId,
        keyPair: {
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
        },
      };

      await this.keyStore.storePreKey(keyId, record);
    }
  }

  async getPreKeyBundle(params: {
    identityKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
    registrationId: number;
  }): Promise<PreKeyBundleResult> {
    // Get a pre-key (remove it from store after use)
    const preKeyIds = await this.keyStore.getAllPreKeyIds();
    let preKey: PreKeyRecord | null = null;
    if (preKeyIds.length > 0) {
      const keyId = preKeyIds[0]!;
      preKey = await this.keyStore.loadPreKey(keyId);
      if (preKey) {
        await this.keyStore.removePreKey(keyId);
      }
    }

    // Get signed pre-key
    const signedPreKeyIds = await this.keyStore.getAllSignedPreKeyIds();
    let signedPreKey: SignedPreKeyRecord | null = null;
    if (signedPreKeyIds.length > 0) {
      signedPreKey = await this.keyStore.loadSignedPreKey(signedPreKeyIds[0]!);
    }

    return {
      registrationId: params.registrationId,
      identityKey: params.identityKeyPair.publicKey,
      signedPreKey: signedPreKey
        ? {
            keyId: signedPreKey.id,
            publicKey: signedPreKey.keyPair.publicKey,
            signature: signedPreKey.signature,
          }
        : null,
      preKey: preKey
        ? {
            keyId: preKey.id,
            publicKey: preKey.keyPair.publicKey,
          }
        : null,
    };
  }

  // ─── Chain Management ─────────────────────────────────────────

  createChain(): ChainState {
    return {
      chainKey: randomBytes(32),
      counter: 0,
      messageKeys: new Map(),
    };
  }

  advanceChain(chain: ChainState): { chainKey: Uint8Array; messageKey: Uint8Array } {
    // HKDF-based chain key advancement
    const messageKey = createHash("sha256")
      .update(chain.chainKey)
      .update(Buffer.from("message"))
      .digest();

    const nextChainKey = createHash("sha256")
      .update(chain.chainKey)
      .update(Buffer.from("chain"))
      .digest();

    const newChain: ChainState = {
      chainKey: nextChainKey,
      counter: chain.counter + 1,
      messageKeys: chain.messageKeys,
    };

    // Store message key for out-of-order decryption
    newChain.messageKeys.set(chain.counter, messageKey);

    return { chainKey: nextChainKey, messageKey };
  }

  // ─── Utility ──────────────────────────────────────────────────

  private generateKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
    // Simplified key pair generation
    // In production, this would use Curve25519/X25519
    const privateKey = randomBytes(32);
    const publicKey = createHash("sha256")
      .update(privateKey)
      .update(Buffer.from("public"))
      .digest();

    return {
      publicKey: new Uint8Array(publicKey),
      privateKey: new Uint8Array(privateKey),
    };
  }
}

// ─── Interfaces ─────────────────────────────────────────────────

export interface CreateSessionParams {
  remoteIdentityKey: Uint8Array;
  localRegistrationId: number;
  remoteRegistrationId?: number;
  rootKey?: Uint8Array;
  pendingPreKey?: {
    preKeyId: number;
    signedPreKeyId: number;
    baseKey: Uint8Array;
  };
}

export interface PreKeyBundleResult {
  registrationId: number;
  identityKey: Uint8Array;
  signedPreKey: {
    keyId: number;
    publicKey: Uint8Array;
    signature: Uint8Array;
  } | null;
  preKey: {
    keyId: number;
    publicKey: Uint8Array;
  } | null;
}
