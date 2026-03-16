// ClawChat — Encryption Layer Type Definitions

// ─── Signal Protocol Keys ────────────────────────────────────────

export interface IdentityKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface PreKeyBundle {
  identityKey: Uint8Array;
  registrationId: number;
  deviceId: number;
  signedPreKey: {
    keyId: number;
    publicKey: Uint8Array;
    signature: Uint8Array;
  };
  preKey?: {
    keyId: number;
    publicKey: Uint8Array;
  };
}

export interface PreKeyRecord {
  id: number;
  keyPair: IdentityKeyPair;
}

export interface SignedPreKeyRecord {
  id: number;
  keyPair: IdentityKeyPair;
  signature: Uint8Array;
  timestamp: number;
}

// ─── Signal Message ──────────────────────────────────────────────

export interface SignalMessage {
  type: "message" | "prekey-message";
  body: Uint8Array;
  registrationId?: number;
  deviceId?: number;
}

// ─── Session State ───────────────────────────────────────────────

export interface SessionState {
  peerId: string;
  sessionVersion: number;
  remoteIdentityKey: Uint8Array | null;
  localRegistrationId: number;
  remoteRegistrationId: number | null;
  rootKey: Uint8Array | null;
  sendingChain: ChainState | null;
  receivingChains: ChainState[];
  pendingPreKey: PendingPreKey | null;
  previousCounter: number;
  createdAt: number;
  lastUsed: number;
}

export interface ChainState {
  chainKey: Uint8Array;
  counter: number;
  messageKeys: Map<number, Uint8Array>;
}

export interface PendingPreKey {
  preKeyId: number | null;
  signedPreKeyId: number;
  baseKey: Uint8Array;
}

// ─── Key Store Interface ─────────────────────────────────────────

export interface SignalKeyStore {
  // Identity keys
  getIdentityKeyPair(): Promise<IdentityKeyPair | null>;
  setIdentityKeyPair(keyPair: IdentityKeyPair): Promise<void>;

  // Registration ID
  getLocalRegistrationId(): Promise<number>;
  setLocalRegistrationId(id: number): Promise<void>;

  // Pre-keys
  loadPreKey(keyId: number): Promise<PreKeyRecord | null>;
  storePreKey(keyId: number, record: PreKeyRecord): Promise<void>;
  removePreKey(keyId: number): Promise<void>;
  getAllPreKeyIds(): Promise<number[]>;

  // Signed pre-keys
  loadSignedPreKey(keyId: number): Promise<SignedPreKeyRecord | null>;
  storeSignedPreKey(keyId: number, record: SignedPreKeyRecord): Promise<void>;
  removeSignedPreKey(keyId: number): Promise<void>;
  getAllSignedPreKeyIds(): Promise<number[]>;

  // Sessions
  loadSession(peerId: string): Promise<SessionState | null>;
  storeSession(peerId: string, session: SessionState): Promise<void>;
  removeSession(peerId: string): Promise<void>;
  getAllSessionPeerIds(): Promise<string[]>;

  // Trusted identity
  isTrustedIdentity(peerId: string, identityKey: Uint8Array): Promise<boolean>;
  saveTrustedIdentity(peerId: string, identityKey: Uint8Array): Promise<void>;

  // Cleanup
  clearAll(): Promise<void>;
}

// ─── Encryption Interface ────────────────────────────────────────

export interface EncryptionLayer {
  initialize(): Promise<void>;
  getIdentity(): IdentityKeyPair;
  getPreKeyBundle(): Promise<PreKeyBundle>;
  processPreKeyBundle(peerId: string, bundle: PreKeyBundle): Promise<void>;
  encrypt(peerId: string, plaintext: Uint8Array): Promise<SignalMessage>;
  decrypt(peerId: string, message: SignalMessage): Promise<Uint8Array>;
  hasSession(peerId: string): Promise<boolean>;
  deleteSession(peerId: string): Promise<void>;
  getStats(): EncryptionStats;
}

export interface EncryptionStats {
  identityKeyFingerprint: string;
  registrationId: number;
  activeSessions: number;
  totalPreKeys: number;
  totalSignedPreKeys: number;
}

// ─── Key Derivation ──────────────────────────────────────────────

export interface DerivedKeys {
  chainKey: Uint8Array;
  messageKey: Uint8Array;
}
