// ClawChat — Invitation Tool
import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.ts";

const MODULE = "invite";

// ─── Invitation Types ────────────────────────────────────────────

export interface InvitationPayload {
  version: 1;
  serverUrl: string;
  serverHost: string;
  serverPort: number;
  roomId: string;
  tempKey: string;
  createdBy: string;
  createdAt: number;
  expiry: number;
}

export interface GeneratedInvitation {
  code: string;           // claw:xxx 格式的邀请码
  prompt: string;         // 可复制的提示词
  deepLink: string;       // 深度链接
  roomId: string;
  expiresAt: string;
}

// ─── Invitation Generator ────────────────────────────────────────

/**
 * Detect if the current environment should use secure WebSocket.
 * Returns true if running behind HTTPS or if explicitly configured.
 */
function detectSecureMode(): boolean {
  // Check environment variables for explicit configuration
  if (process.env.CLAWCHAT_SECURE === "true") return true;
  if (process.env.CLAWCHAT_SECURE === "false") return false;

  // Auto-detect from common indicators
  const isProduction = process.env.NODE_ENV === "production";
  const hasHttpsUrl = process.env.URL?.startsWith("https://");
  const hasSecureHeader = process.env.HTTPS === "on" || process.env.HTTPS === "1";
  const hasForwardedProto = process.env.X_FORWARDED_PROTO === "https";

  return isProduction || hasHttpsUrl || hasSecureHeader || hasForwardedProto;
}

export function generateInvitation(options: {
  serverHost: string;
  serverPort: number;
  displayName: string;
  expiresInHours?: number;
  secure?: boolean;
}): GeneratedInvitation {
  const {
    serverHost,
    serverPort,
    displayName,
    expiresInHours = 24,
    secure = detectSecureMode(),
  } = options;

  const protocol = secure ? "wss" : "ws";
  const roomId = `room_${randomBytes(8).toString("hex")}`;
  const tempKey = randomBytes(32).toString("hex");
  const createdAt = Date.now();
  const expiry = createdAt + expiresInHours * 60 * 60 * 1000;

  const payload: InvitationPayload = {
    version: 1,
    serverUrl: `${protocol}://${serverHost}:${serverPort}/ws`,
    serverHost,
    serverPort,
    roomId,
    tempKey,
    createdBy: displayName,
    createdAt,
    expiry,
  };

  // Encode to base64url
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  const code = `claw:${encoded}`;

  // Generate human-readable prompt
  const prompt = generatePrompt(code, displayName, expiresInHours);

  // Generate deep link (for future use)
  const deepLink = `clawchat://join?code=${encoded}`;

  logger.info(MODULE, `Generated invitation for room ${roomId}`);

  return {
    code,
    prompt,
    deepLink,
    roomId,
    expiresAt: new Date(expiry).toISOString(),
  };
}

// ─── Generate Shareable Prompt ─────────────────────────────────────

function generatePrompt(code: string, displayName: string, expiresInHours: number): string {
  return `🐾 ClawChat 连接邀请

来自: ${displayName}
有效期: ${expiresInHours} 小时

请复制下面的邀请码，发给你的 OpenClaw：

\`\`\`
${code}
\`\`\`

或者直接发送这段话：

"请帮我连接到 ClawChat 网络，使用邀请码：${code}"

操作步骤：
1. 确保 ClawChat 插件已安装
2. 使用 claw_connect 工具，action=invitation，inviteCode="${code}"
3. 等待连接成功`;
}

// ─── Parse Invitation Code ─────────────────────────────────────────

export function parseInvitationCode(code: string): InvitationPayload | null {
  // Handle different formats
  let rawCode = code.trim();

  // Extract from prompt if user pasted the whole prompt
  const codeMatch = rawCode.match(/claw:[A-Za-z0-9_-]+/);
  if (codeMatch) {
    rawCode = codeMatch[0];
  }

  // Validate format
  if (!rawCode.startsWith("claw:")) {
    logger.warn(MODULE, "Invalid invitation code format");
    return null;
  }

  const encoded = rawCode.slice(5);

  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    const payload = JSON.parse(json) as InvitationPayload;

    // Validate version
    if (payload.version !== 1) {
      logger.warn(MODULE, `Unsupported invitation version: ${payload.version}`);
      return null;
    }

    // Check expiry
    if (Date.now() > payload.expiry) {
      logger.warn(MODULE, "Invitation code has expired");
      return null;
    }

    return payload;
  } catch (err) {
    logger.error(MODULE, `Failed to parse invitation: ${err}`);
    return null;
  }
}

// ─── Format Invitation for Display ─────────────────────────────────

export function formatInvitationForDisplay(invitation: GeneratedInvitation): string {
  return `
╔══════════════════════════════════════════════════════════════╗
║                   🐾 ClawChat 邀请码                        ║
╠══════════════════════════════════════════════════════════════╣
║  房间 ID: ${invitation.roomId}
║  过期时间: ${invitation.expiresAt}
╠══════════════════════════════════════════════════════════════╣
║  邀请码:                                                    ║
║  ${invitation.code.slice(0, 50)}...
╠══════════════════════════════════════════════════════════════╣
║  复制下面的提示词发给朋友：                                  ║
╚══════════════════════════════════════════════════════════════╝

${invitation.prompt}
`;
}