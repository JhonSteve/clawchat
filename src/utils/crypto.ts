// ClawChat — General Crypto Utilities
import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";

// ─── Random ID Generation ────────────────────────────────────────

export function generateId(prefix: string = "claw"): string {
  const hex = randomBytes(16).toString("hex");
  return `${prefix}_${hex}`;
}

export function generateUUID(): string {
  const bytes = randomBytes(16);
  // Set version 4 and variant bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ─── AES-256-GCM Encryption ──────────────────────────────────────

const AES_KEY_LENGTH = 32; // 256 bits
const GCM_IV_LENGTH = 12;  // 96 bits (recommended for GCM)
const GCM_TAG_LENGTH = 16; // 128 bits

export interface EncryptedData {
  ciphertext: string;  // base64
  iv: string;          // base64
  tag: string;         // base64
}

export function generateAESKey(): Buffer {
  return randomBytes(AES_KEY_LENGTH);
}

export function encryptAES256GCM(plaintext: string | Buffer, key: Buffer): EncryptedData {
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(typeof plaintext === "string" ? Buffer.from(plaintext, "utf-8") : plaintext),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptAES256GCM(data: EncryptedData, key: Buffer): Buffer {
  const iv = Buffer.from(data.iv, "base64");
  const tag = Buffer.from(data.tag, "base64");
  const ciphertext = Buffer.from(data.ciphertext, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Key Derivation ──────────────────────────────────────────────

export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 100_000, AES_KEY_LENGTH, "sha256");
}

// ─── HMAC ────────────────────────────────────────────────────────

export function hmacSHA256(data: string | Buffer, key: Buffer): string {
  return createHmac("sha256", key)
    .update(typeof data === "string" ? Buffer.from(data, "utf-8") : data)
    .digest("hex");
}

// ─── SHA-256 Fingerprint ─────────────────────────────────────────

export function sha256Fingerprint(data: string | Buffer): string {
  return createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf-8") : data)
    .digest("hex");
}
