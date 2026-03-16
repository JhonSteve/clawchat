// ClawChat — Tag Extraction and Classification

export interface AgentTag {
  category: string;
  specialty: string;
  confidence: number;
  evidence: string[];
}

// ─── Tag Categories ──────────────────────────────────────────────

export const TAG_CATEGORIES: Record<string, string[]> = {
  编程: ["前端", "后端", "全栈", "移动端", "DevOps", "数据工程", "AI/ML", "区块链"],
  写作: ["技术文档", "博客", "社交媒体", "营销文案", "学术写作"],
  数据分析: ["统计分析", "数据可视化", "机器学习", "商业分析", "NLP"],
  设计: ["UI/UX", "品牌设计", "插画", "3D建模"],
  研究: ["学术研究", "市场调研", "竞品分析", "文献综述"],
  运营: ["社交媒体运营", "SEO", "广告投放", "用户增长", "项目管理"],
  翻译: ["中英翻译", "多语言翻译", "本地化"],
  其他: ["通用助手", "咨询顾问", "创意策划"],
};

// ─── Keyword Mappings ────────────────────────────────────────────

const KEYWORD_TAGS: Array<{ keywords: RegExp[]; category: string; specialty: string }> = [
  // 编程
  { keywords: [/react/i, /vue/i, /angular/i, /typescript/i, /css/i, /html/i, /tailwind/i, /next\.?js/i], category: "编程", specialty: "前端" },
  { keywords: [/node\.?js/i, /express/i, /fastify/i, /nest\.?js/i, /python/i, /django/i, /flask/i, /go lang/i, /rust/i, /java/i, /spring/i], category: "编程", specialty: "后端" },
  { keywords: [/fullstack/i, /full.?stack/i, /全栈/i], category: "编程", specialty: "全栈" },
  { keywords: [/ios/i, /android/i, /flutter/i, /react.?native/i, /swift/i, /kotlin/i], category: "编程", specialty: "移动端" },
  { keywords: [/docker/i, /kubernetes/i, /k8s/i, /ci\/cd/i, /jenkins/i, /github.?actions/i, /terraform/i, /ansible/i], category: "编程", specialty: "DevOps" },
  { keywords: [/sql/i, /postgres/i, /mysql/i, /mongo/i, /redis/i, /etl/i, /spark/i, /airflow/i], category: "编程", specialty: "数据工程" },
  { keywords: [/machine.?learning/i, /deep.?learning/i, /pytorch/i, /tensorflow/i, /llm/i, /gpt/i, /transformer/i], category: "编程", specialty: "AI/ML" },

  // 写作
  { keywords: [/技术文档/i, /api.?doc/i, /readme/i, /documentation/i], category: "写作", specialty: "技术文档" },
  { keywords: [/blog/i, /博客/i, /article/i, /文章/i, /post/i], category: "写作", specialty: "博客" },
  { keywords: [/twitter/i, /linkedin/i, /社交/i, /social.?media/i], category: "写作", specialty: "社交媒体" },
  { keywords: [/copywrit/i, /广告文案/i, /营销/i, /marketing/i], category: "写作", specialty: "营销文案" },

  // 数据分析
  { keywords: [/pandas/i, /numpy/i, /scipy/i, /statistics/i, /统计/i, /分析/i, /analytics/i], category: "数据分析", specialty: "统计分析" },
  { keywords: [/chart/i, /graph/i, /dashboard/i, /d3\.?js/i, /echarts/i, /可视化/i, /visualization/i], category: "数据分析", specialty: "数据可视化" },

  // 运营
  { keywords: [/seo/i, /sem/i, /google.?analytics/i, /增长/i, /growth/i, /运营/i], category: "运营", specialty: "用户增长" },
  { keywords: [/ads/i, /广告/i, /campaign/i, /投放/i], category: "运营", specialty: "广告投放" },
];

// ─── Tag Extractor ───────────────────────────────────────────────

export function extractTags(text: string): AgentTag[] {
  const tags: AgentTag[] = [];
  const textLower = text.toLowerCase();

  for (const mapping of KEYWORD_TAGS) {
    const matches: string[] = [];
    for (const pattern of mapping.keywords) {
      const match = textLower.match(pattern);
      if (match) matches.push(match[0]);
    }

    if (matches.length > 0) {
      // Find existing tag or create new
      const existing = tags.find(
        (t) => t.category === mapping.category && t.specialty === mapping.specialty,
      );

      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.1 * matches.length);
        existing.evidence.push(...matches);
      } else {
        tags.push({
          category: mapping.category,
          specialty: mapping.specialty,
          confidence: Math.min(0.9, 0.3 + 0.15 * matches.length),
          evidence: matches,
        });
      }
    }
  }

  // Sort by confidence
  tags.sort((a, b) => b.confidence - a.confidence);

  return tags;
}

export function extractTagsFromFiles(filePaths: string[], fileContents: Map<string, string>): AgentTag[] {
  const allTexts: string[] = [];

  for (const [path, content] of fileContents) {
    // Focus on configuration and documentation files
    const filename = path.toLowerCase();
    if (
      filename.endsWith(".md") ||
      filename.endsWith(".json") ||
      filename.endsWith(".yaml") ||
      filename.endsWith(".yml") ||
      filename.endsWith(".toml") ||
      filename.includes("readme") ||
      filename.includes("package") ||
      filename.includes("config")
    ) {
      allTexts.push(content);
    }
  }

  const combinedText = allTexts.join("\n");
  return extractTags(combinedText);
}

export function formatTagsForDisplay(tags: AgentTag[]): string {
  if (tags.length === 0) return "通用助手";

  return tags
    .slice(0, 5)
    .map((t) => `${t.specialty} (${Math.round(t.confidence * 100)}%)`)
    .join(", ");
}
