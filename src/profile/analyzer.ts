// ClawChat — Agent Self-Analysis Engine
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { extractTags, formatTagsForDisplay, type AgentTag } from "./tags.ts";
import { logger } from "../utils/logger.ts";

const MODULE = "analyzer";

export interface AnalysisResult {
  workspaceFiles: number;
  totalSize: number;
  fileTypes: Record<string, number>;
  tags: AgentTag[];
  toolUsage: Record<string, number>;
  estimatedTokens: number;
  lastModified: number;
}

export class AgentAnalyzer {
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  // ─── Full Analysis ───────────────────────────────────────────

  async analyze(maxDepth: number = 3): Promise<AnalysisResult> {
    const files = await this.scanDirectory(this.workspaceDir, maxDepth);
    const fileTypes: Record<string, number> = {};
    const fileContents = new Map<string, string>();
    let totalSize = 0;
    let lastModified = 0;

    for (const file of files) {
      const ext = extname(file.path).toLowerCase() || "(none)";
      fileTypes[ext] = (fileTypes[ext] ?? 0) + 1;
      totalSize += file.size;
      lastModified = Math.max(lastModified, file.mtime);

      // Read text files for tag extraction
      if (this.isTextFile(file.path) && file.size < 100_000) {
        try {
          const content = await readFile(file.path, "utf-8");
          fileContents.set(file.path, content);
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Extract tags from file contents
    const tags = extractTags(
      [...fileContents.values()].join("\n"),
    );

    // Analyze tool usage from file names
    const toolUsage = this.analyzeToolUsage(files);

    // Estimate total tokens used (rough: 1 token ≈ 4 chars)
    const estimatedTokens = Math.round(totalSize / 4);

    return {
      workspaceFiles: files.length,
      totalSize,
      fileTypes,
      tags,
      toolUsage,
      estimatedTokens,
      lastModified,
    };
  }

  // ─── Quick Profile Generation ────────────────────────────────

  async generateProfileSummary(): Promise<string> {
    const result = await this.analyze(2);
    const tagDisplay = formatTagsForDisplay(result.tags);
    const tokensUsed = formatTokenCount(result.estimatedTokens);

    return `专长: ${tagDisplay} | 已消耗 token: ${tokensUsed} | 文件数: ${result.workspaceFiles}`;
  }

  // ─── Directory Scanning ──────────────────────────────────────

  private async scanDirectory(
    dir: string,
    maxDepth: number,
    currentDepth: number = 0,
  ): Promise<FileInfo[]> {
    if (currentDepth >= maxDepth) return [];

    const files: FileInfo[] = [];
    const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".cache"]);

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) {
            const subFiles = await this.scanDirectory(fullPath, maxDepth, currentDepth + 1);
            files.push(...subFiles);
          }
        } else if (entry.isFile()) {
          try {
            const info = await stat(fullPath);
            files.push({
              path: fullPath,
              name: entry.name,
              size: info.size,
              mtime: info.mtimeMs,
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return files;
  }

  private isTextFile(filePath: string): boolean {
    const textExtensions = new Set([
      ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".xml",
      ".ts", ".js", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
      ".html", ".css", ".scss", ".sql", ".sh", ".bash", ".zsh",
      ".env", ".config", ".ini", ".cfg",
    ]);
    const ext = extname(filePath).toLowerCase();
    return textExtensions.has(ext);
  }

  private analyzeToolUsage(files: FileInfo[]): Record<string, number> {
    const usage: Record<string, number> = {};
    const toolPatterns: Record<string, RegExp[]> = {
      "read": [/\.md$/, /\.txt$/, /\.json$/],
      "write": [/\.ts$/, /\.js$/, /\.py$/, /\.go$/],
      "exec": [/\.sh$/, /\.bash$/, /Makefile$/, /Dockerfile$/],
      "web_search": [/\.html$/, /\.css$/],
    };

    for (const file of files) {
      for (const [tool, patterns] of Object.entries(toolPatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(file.name)) {
            usage[tool] = (usage[tool] ?? 0) + 1;
          }
        }
      }
    }

    return usage;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

// ─── Types ──────────────────────────────────────────────────────

interface FileInfo {
  path: string;
  name: string;
  size: number;
  mtime: number;
}
