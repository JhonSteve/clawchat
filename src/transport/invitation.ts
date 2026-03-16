// ClawChat — Invitation Code System
import { randomBytes, createHash } from "node:crypto";
import { logger } from "../utils/logger.ts";
import type { InvitationCode } from "./types.ts";

const MODULE = "invitation";

// ─── Invitation Code Format ──────────────────────────────────────
// claw:BASE64URL(serverUrl|roomId|tempKey|expiry)
// The tempKey is used for initial E2E key exchange

export interface InvitationPayload {
  serverUrl: string;
  roomId: string;
  tempKey: string;
  expiry: number;
  signature: string;
}

export class InvitationManager {
  private localInvitations = new Map<string, InvitationPayload>();

  // ─── Create Invitation ────────────────────────────────────────

  createInvitation(
    serverUrl: string,
    roomId: string,
    expiresInHours: number = 24,
  ): InvitationCode {
    const tempKey = randomBytes(32).toString("hex");
    const expiry = Date.now() + expiresInHours * 60 * 60 * 1000;

    // Create signature
    const signatureInput = `${serverUrl}|${roomId}|${tempKey}|${expiry}`;
    const signature = createHash("sha256")
      .update(signatureInput)
      .digest("hex")
      .slice(0, 16);

    const payload: InvitationPayload = {
      serverUrl,
      roomId,
      tempKey,
      expiry,
      signature,
    };

    // Encode to invitation code
    const json = JSON.stringify(payload);
    const encoded = Buffer.from(json, "utf-8").toString("base64url");
    const code = `claw:${encoded}`;

    // Store locally
    this.localInvitations.set(code, payload);

    logger.info(MODULE, `Invitation created for room ${roomId} (expires in ${expiresInHours}h)`);

    return { code, serverUrl, roomId, tempKey };
  }

  // ─── Redeem Invitation ────────────────────────────────────────

  redeemInvitation(code: string): InvitationPayload | null {
    // Validate format
    if (!code.startsWith("claw:")) {
      logger.warn(MODULE, "Invalid invitation code format");
      return null;
    }

    const encoded = code.slice(5); // Remove "claw:" prefix

    try {
      const json = Buffer.from(encoded, "base64url").toString("utf-8");
      const payload = JSON.parse(json) as InvitationPayload;

      // Check expiry
      if (Date.now() > payload.expiry) {
        logger.warn(MODULE, "Invitation code has expired");
        return null;
      }

      // Verify signature
      const signatureInput = `${payload.serverUrl}|${payload.roomId}|${payload.tempKey}|${payload.expiry}`;
      const expectedSig = createHash("sha256")
        .update(signatureInput)
        .digest("hex")
        .slice(0, 16);

      if (payload.signature !== expectedSig) {
        logger.warn(MODULE, "Invitation code signature verification failed");
        return null;
      }

      logger.info(MODULE, `Invitation redeemed for room ${payload.roomId}`);
      return payload;
    } catch {
      logger.warn(MODULE, "Failed to parse invitation code");
      return null;
    }
  }

  // ─── Validation ───────────────────────────────────────────────

  isValidCode(code: string): boolean {
    return this.redeemInvitation(code) !== null;
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  cleanupExpired(): void {
    const now = Date.now();
    for (const [code, payload] of this.localInvitations) {
      if (now > payload.expiry) {
        this.localInvitations.delete(code);
      }
    }
  }

  getActiveInvitations(): InvitationPayload[] {
    return [...this.localInvitations.values()];
  }
}
