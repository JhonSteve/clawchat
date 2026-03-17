// ClawChat — OpenClaw Plugin Entry Point
import type { Plugin } from "@opencode-ai/plugin";
import { logger } from "./utils/logger.ts";
import { loadConfig, ensureDataDir, type ClawChatConfig } from "./config.ts";
import {
  createSignalingService,
  type SignalingService,
  type SignalingServiceOptions,
} from "./signaling/index.ts";
import {
  generateInvitation,
  parseInvitationCode,
  formatInvitationForDisplay,
  type GeneratedInvitation,
} from "./tools/claw_invite.ts";

let clawchatConfig: ClawChatConfig;
let signalingService: SignalingService | null = null;

// ─── Signaling Service Helpers ─────────────────────────────────────

async function startEmbeddedSignalingService(): Promise<void> {
  if (signalingService !== null) {
    logger.info("signaling", "Signaling service already running");
    return;
  }

  const options: SignalingServiceOptions = {
    port: clawchatConfig.signalingPort ?? 3478,
    host: clawchatConfig.signalingHost ?? "127.0.0.1",
    authToken: clawchatConfig.signalingToken,
    onLog: (category, message) => logger.info(category, message),
  };

  signalingService = createSignalingService(options);

  try {
    await signalingService.start();
    const state = signalingService.getState();
    logger.info(
      "signaling",
      `Embedded signaling service started on ws://${state.host}:${state.port}/ws`,
    );
  } catch (err) {
    logger.error("signaling", `Failed to start signaling service: ${err}`);
    signalingService = null;
  }
}

async function stopEmbeddedSignalingService(): Promise<void> {
  if (signalingService === null) {
    logger.info("signaling", "Signaling service not running");
    return;
  }

  await signalingService.stop();
  signalingService = null;
  logger.info("signaling", "Embedded signaling service stopped");
}

function getSignalingServiceState() {
  return signalingService?.getState() ?? null;
}

export default function clawchatPlugin(api: Plugin) {
  // ─── Initialize ─────────────────────────────────────────────
  ensureDataDir();
  clawchatConfig = loadConfig(api.config);

  logger.info("core", `ClawChat plugin initialized`);
  logger.info("core", `Display name: ${clawchatConfig.displayName ?? "auto"}`);

  // ─── Auto-start Signaling Service (if configured) ───────────
  if (clawchatConfig.signalingServer === "embedded" || clawchatConfig.signalingPort) {
    startEmbeddedSignalingService();
  }

  // ─── Register Tools ─────────────────────────────────────────

  // claw_connect — Connect to signaling server or peer via invitation
  api.registerTool({
    name: "claw_connect",
    description: "连接到 ClawChat 网络。可以通过信令服务器地址连接，或使用邀请码连接到指定 Peer。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["signaling", "invitation", "status", "disconnect"],
          description: "操作类型: signaling(连接信令服务器), invitation(通过邀请码连接), status(查看状态), disconnect(断开)",
        },
        serverUrl: {
          type: "string",
          description: "信令服务器地址 (action=signaling 时使用)",
        },
        inviteCode: {
          type: "string",
          description: "邀请码 (action=invitation 时使用)",
        },
        authToken: {
          type: "string",
          description: "认证 token (可选)",
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      if (params.action === "invitation" && params.inviteCode) {
        const payload = parseInvitationCode(params.inviteCode);
        if (!payload) {
          return {
            content: JSON.stringify({
              success: false,
              error: "invalid_or_expired",
              message: "邀请码无效或已过期",
            }, null, 2),
          };
        }

        return {
          content: JSON.stringify({
            success: true,
            message: "邀请码验证成功",
            connection: {
              serverUrl: payload.serverUrl,
              roomId: payload.roomId,
              createdBy: payload.createdBy,
              expiresAt: new Date(payload.expiry).toISOString(),
            },
            nextStep: "正在连接到信令服务器...",
            // TODO: 实际连接逻辑需要 ConnectionManager
          }, null, 2),
        };
      }

      if (params.action === "status") {
        const signalingState = getSignalingServiceState();
        return {
          content: JSON.stringify({
            signaling: signalingState,
            config: {
              displayName: clawchatConfig.displayName,
              signalingPort: clawchatConfig.signalingPort,
            },
          }, null, 2),
        };
      }

      if (params.action === "disconnect") {
        // TODO: 实际断开连接逻辑
        return {
          content: JSON.stringify({
            success: true,
            message: "已断开所有连接",
          }, null, 2),
        };
      }

      return { content: `ClawConnect: action=${params.action} (placeholder)` };
    },
  });

  // claw_chat — Send messages to peers
  api.registerTool({
    name: "claw_chat",
    description: "向其他 ClawChat Agent 发送消息。支持单播、广播和群组消息。",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "目标: Peer ID, 'broadcast'(广播), 或 Group ID",
        },
        message: {
          type: "string",
          description: "消息内容",
        },
        format: {
          type: "string",
          enum: ["text", "markdown", "code"],
          default: "markdown",
          description: "消息格式",
        },
      },
      required: ["target", "message"],
    },
    execute: async (params) => {
      // TODO: Phase 5 — Wire to MessageRouter
      return { content: `ClawChat: sent to ${params.target} (placeholder)` };
    },
  });

  // claw_delegate — Delegate tasks to other agents
  api.registerTool({
    name: "claw_delegate",
    description: "将任务委托给其他 ClawChat Agent。可以指定专长要求和资源限制。",
    parameters: {
      type: "object",
      properties: {
        peerId: {
          type: "string",
          description: "目标 Agent 的 ID",
        },
        title: {
          type: "string",
          description: "任务标题",
        },
        description: {
          type: "string",
          description: "任务详细描述",
        },
        context: {
          type: "string",
          description: "相关上下文信息",
        },
        maxTokens: {
          type: "number",
          description: "最大 token 消耗限制",
        },
        deadline: {
          type: "string",
          description: "截止时间 (ISO 8601)",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          default: "medium",
        },
      },
      required: ["peerId", "title", "description"],
    },
    execute: async (params) => {
      // TODO: Phase 5 — Wire to DelegationHandler
      return { content: `ClawDelegate: task "${params.title}" → ${params.peerId} (placeholder)` };
    },
  });

  // claw_peers — View connected peers and their profiles
  api.registerTool({
    name: "claw_peers",
    description: "查看已连接的 ClawChat Agent 列表及其专长标签、状态信息。",
    parameters: {
      type: "object",
      properties: {
        detail: {
          type: "boolean",
          default: false,
          description: "是否显示详细 Profile 信息",
        },
      },
    },
    execute: async (params) => {
      // TODO: Phase 4 — Wire to ProfileManager
      return { content: `ClawPeers: listing peers (placeholder)` };
    },
  });

  // claw_knowledge — Query or add to private knowledge base
  api.registerTool({
    name: "claw_knowledge",
    description: "查询或添加到 ClawChat 私有知识库。支持语义搜索和跨 Agent 知识共享。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "add", "list", "delete"],
          description: "操作类型",
        },
        query: {
          type: "string",
          description: "搜索查询 (action=search 时使用)",
        },
        content: {
          type: "string",
          description: "知识条目内容 (action=add 时使用)",
        },
        category: {
          type: "string",
          description: "分类标签",
        },
        accessLevel: {
          type: "string",
          enum: ["private", "shared", "public"],
          default: "private",
          description: "访问级别",
        },
        peerId: {
          type: "string",
          description: "允许访问的 Peer ID (accessLevel=shared 时使用)",
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      // TODO: Phase 6 — Wire to KnowledgeStore
      return { content: `ClawKnowledge: action=${params.action} (placeholder)` };
    },
  });

  // claw_group — Group management
  api.registerTool({
    name: "claw_group",
    description: "管理 ClawChat 群组：创建、邀请、退出、查看成员。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "invite", "leave", "list", "info"],
          description: "操作类型",
        },
        name: {
          type: "string",
          description: "群组名称 (action=create 时使用)",
        },
        groupId: {
          type: "string",
          description: "群组 ID",
        },
        peerId: {
          type: "string",
          description: "要邀请的 Peer ID (action=invite 时使用)",
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      // TODO: Phase 5 — Wire to GroupManager
      return { content: `ClawGroup: action=${params.action} (placeholder)` };
    },
  });

  // claw_config — View/modify ClawChat configuration
  api.registerTool({
    name: "claw_config",
    description: "查看或修改 ClawChat 配置：Token 预算、时间窗口、显示名称等。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "budget", "schedule"],
          description: "操作类型",
        },
        key: {
          type: "string",
          description: "配置键 (action=set 时使用)",
        },
        value: {
          description: "配置值 (action=set 时使用)",
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      if (params.action === "get") {
        return { content: JSON.stringify(clawchatConfig, null, 2) };
      }
      return { content: `ClawConfig: action=${params.action} (placeholder)` };
    },
  });

  // claw_invite — Generate shareable invitation
  api.registerTool({
    name: "claw_invite",
    description: "生成 ClawChat 邀请码。生成后可以复制提示词发给朋友，对方发给自己的 OpenClaw 就能直接连接。",
    parameters: {
      type: "object",
      properties: {
        expiresInHours: {
          type: "number",
          default: 24,
          description: "邀请码有效期（小时），默认 24 小时",
        },
        displayName: {
          type: "string",
          description: "你的显示名称（可选，用于邀请信息）",
        },
      },
    },
    execute: async (params) => {
      const signalingState = getSignalingServiceState();
      
      // Check if signaling service is running
      if (!signalingState?.running) {
        return {
          content: JSON.stringify({
            success: false,
            error: "signaling_not_running",
            message: "信令服务未运行，请先使用 claw_signaling start 启动",
            hint: "运行: claw_signaling start",
          }, null, 2),
        };
      }

      const displayName = params.displayName ?? clawchatConfig.displayName ?? "OpenClaw Agent";
      const expiresInHours = params.expiresInHours ?? 24;

      const invitation = generateInvitation({
        serverHost: signalingState.host,
        serverPort: signalingState.port,
        displayName,
        expiresInHours,
      });

      return {
        content: formatInvitationForDisplay(invitation),
      };
    },
  });

  // claw_status — Connection status and token usage
  api.registerTool({
    name: "claw_status",
    description: "查看 ClawChat 连接状态、Token 使用情况和运行统计。",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      // TODO: Phase 7 — Wire to Governor
      const signalingState = getSignalingServiceState();
      return {
        content: JSON.stringify(
          {
            status: "initialized",
            config: clawchatConfig,
            uptime: process.uptime(),
            signaling: signalingState,
          },
          null,
          2,
        ),
      };
    },
  });

  // claw_signaling — Control embedded signaling service
  api.registerTool({
    name: "claw_signaling",
    description: "管理内置信令服务：启动、停止、查看状态。信令服务用于 P2P 连接建立和房间管理。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "status"],
          description: "操作类型: start(启动), stop(停止), status(查看状态)",
        },
        port: {
          type: "number",
          description: "信令服务端口 (action=start 时可选，默认 3478)",
        },
        host: {
          type: "string",
          description: "信令服务绑定地址 (action=start 时可选，默认 127.0.0.1)",
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      switch (params.action) {
        case "start": {
          if (params.port) {
            clawchatConfig.signalingPort = params.port;
          }
          if (params.host) {
            clawchatConfig.signalingHost = params.host;
          }
          await startEmbeddedSignalingService();
          const state = getSignalingServiceState();
          return {
            content: JSON.stringify(
              {
                success: state !== null,
                message: state
                  ? `Signaling service started on ws://${state.host}:${state.port}/ws`
                  : "Failed to start signaling service",
                state,
              },
              null,
              2,
            ),
          };
        }
        case "stop": {
          await stopEmbeddedSignalingService();
          return {
            content: JSON.stringify(
              {
                success: true,
                message: "Signaling service stopped",
              },
              null,
              2,
            ),
          };
        }
        case "status": {
          const state = getSignalingServiceState();
          return {
            content: JSON.stringify(
              {
                running: state?.running ?? false,
                state,
              },
              null,
              2,
            ),
          };
        }
        default:
          return { content: `Unknown action: ${params.action}` };
      }
    },
  });

  // ─── Register Background Services ───────────────────────────
  // TODO: Phase 3-8 — Register background services
  // - Signaling connection maintenance
  // - Profile auto-update
  // - Token budget monitoring
  // - Schedule enforcement
  // - Knowledge base sync

  // ─── Register Hooks ─────────────────────────────────────────
  // TODO: Phase 8 — Register before_prompt_build hook to inject peer info

  logger.info("core", "All tools registered (10 tools)");
}

// Export types for external use
export type { ClawChatConfig, BudgetConfig, ScheduleConfig } from "./config.ts";
export type {
  AgentIdentity,
  PeerInfo,
  AgentProfile,
  AgentTag,
  ClawEnvelope,
  MessageType,
  TaskDelegation,
  TaskResult,
  KnowledgeEntry,
  QueryPayload,
  QueryResultPayload,
} from "./protocol/types.ts";

// Export signaling service
export {
  createSignalingService,
  DEFAULT_SIGNALING_CONFIG,
  RoomManager,
  PeerManager,
  SignalingHandler,
} from "./signaling/index.ts";
export type {
  SignalingService,
  SignalingServiceOptions,
  SignalingServiceState,
  SignalingMessage,
  SignalingResponse,
} from "./signaling/index.ts";
