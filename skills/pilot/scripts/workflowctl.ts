#!/usr/bin/env node
// 轻量工作流目录维护工具。
//
// 用 Node 驱动（无需 Python）：依赖 Node 内置 TypeScript type stripping，
// 直接 `node workflowctl.ts <command> ...` 即可运行。
//   - Node ≥ 22.18 / ≥ 23.6：默认启用，无需任何 flag。
//   - Node 22.6 – 22.17：需加 `--experimental-strip-types`。
// 仅使用 node: 内置模块，不引入任何第三方依赖。

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const WORKFLOW_ROOT = path.join(ROOT, ".xft-comat");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// scripts/workflowctl.ts -> 上一层是 skills/pilot（对应原 Path(__file__).parents[1]）。
const SKILL_ROOT = path.dirname(SCRIPT_DIR);
const PLUGIN_ROOT = path.dirname(path.dirname(SKILL_ROOT));
const TEMPLATE_ROOT = path.join(SKILL_ROOT, "templates");

const MODE_DOCS: Record<string, string[]> = {
  "feature-simple": [
    "00-routing.md",
    "01-requirements.md",
    "02-design-note.md",
    "03-test-cases-round-1.md",
    "04-state.md",
    "05-tasks.md",
    "06-skill-usage.md",
  ],
  "feature-medium": [
    "00-routing.md",
    "01-requirements.md",
    "02-design.md",
    "03-test-cases-round-1.md",
    "04-state.md",
    "05-tasks.md",
    "06-skill-usage.md",
  ],
  "feature-hard": [
    "00-routing.md",
    "01-requirements.md",
    "02-design.md",
    "03-test-cases-round-1.md",
    "04-state.md",
    "05-tasks.md",
    "06-skill-usage.md",
  ],
  bugfix: [
    "00-routing.md",
    "01-requirements.md",
    "02-reproduction.md",
    "03-root-cause.md",
    "04-test-cases-round-1.md",
    "05-state.md",
    "06-tasks.md",
    "07-skill-usage.md",
  ],
  refactor: [
    "00-routing.md",
    "01-requirements.md",
    "02-refactor-plan.md",
    "03-safety-net.md",
    "04-test-cases-round-1.md",
    "05-state.md",
    "06-tasks.md",
    "07-skill-usage.md",
  ],
};

const COMMON_PRE_ROUTE_STAGES = ["receive", "explore-and-clarify"];
const ROUTE_STAGE = "final-route";

const MODE_STAGE_TAILS: Record<string, string[]> = {
  "feature-simple": [
    "plan",
    "test-first",
    "implement",
    "targeted-test",
    "review",
    "fix-review-findings",
    "final-verify",
    "close",
  ],
  "feature-medium": [
    "design",
    "user-confirm-if-needed",
    "test-plan",
    "implement",
    "baseline-test",
    "review",
    "fix-and-regression",
    "final-verify",
    "close",
  ],
  "feature-hard": [
    "conductor-plan",
    "architect-options",
    "user-decision",
    "tdd-plan-and-tests",
    "implement",
    "baseline-test",
    "code-review",
    "fix-and-regression",
    "final-e2e-verify",
    "residual-risk",
    "close",
  ],
  bugfix: [
    "reproduce",
    "root-cause",
    "fix-plan",
    "regression-test-first",
    "implement-fix",
    "targeted-test",
    "review",
    "fix-review-findings",
    "regression-verify",
    "close",
  ],
  refactor: [
    "baseline",
    "refactor-plan",
    "safety-net",
    "safety-refactor",
    "baseline-test",
    "review",
    "fix-review-findings",
    "verify-equivalence",
    "close",
  ],
};

const MODE_STAGES: Record<string, string[]> = Object.fromEntries(
  Object.entries(MODE_STAGE_TAILS).map(([mode, tail]) => [
    mode,
    [...COMMON_PRE_ROUTE_STAGES, ROUTE_STAGE, ...tail],
  ]),
);

const PLACEHOLDER_MARKERS = [
  "待补充",
  "TASK-001 — 待补充",
  "初始化后改写",
  "执行后补入证据",
];

const REVIEW_BEFORE_FINAL_VERIFY: Record<string, [string, string]> = {
  "feature-simple": ["review", "final-verify"],
  "feature-medium": ["review", "final-verify"],
  "feature-hard": ["code-review", "final-e2e-verify"],
  bugfix: ["review", "regression-verify"],
  refactor: ["review", "verify-equivalence"],
};

// 路由不再由代码用关键词命中做硬判定。代码只提供“评判框架”，由模型读取后
// 结合任务语义自行判断任务类型与复杂度，再用判断结果调用 init --mode。
const TASK_TYPES: [string, string][] = [
  ["bugfix", "用户描述了错误、异常、失败测试、回归、线上问题或现有行为不符合预期；需先复现和根因。"],
  ["refactor", "用户强调整理结构、重命名、拆分、性能清理、复用、架构改善，且要求外部行为保持不变。"],
  ["feature-simple", "新增或改变功能，但需求清楚、单点改动、低风险（复杂度 0-2 分）。"],
  ["feature-medium", "新增或改变功能，涉及多文件或有设计取舍，但边界可控（复杂度 3-4 分）。"],
  ["feature-hard", "新增或改变功能，跨模块、高风险、需要架构方案和用户关键决策（复杂度 ≥5 分）。"],
];

// 复杂度维度仅作为模型自评的清单，不再附带关键词列表做自动匹配。
const COMPLEXITY_DIMENSIONS: [string, string][] = [
  ["requirements", "需求仍有业务规则、边界条件或验收标准不明确。"],
  ["scope", "涉及 3 个以上文件或 2 个以上模块。"],
  ["infra", "涉及 API、数据库、权限、异步任务、第三方服务、计费、数据迁移或兼容性。"],
  ["ui", "涉及 UI 流程、状态管理、可访问性或浏览器 E2E。"],
  ["decision", "需要架构取舍、方案比较或用户决策。"],
  ["risk", "失败风险高：安全、数据丢失、线上回归、跨端兼容、性能热点。"],
  ["test", "测试策略不直接，需要构造夹具、mock、浏览器或多轮验证。"],
];

const SCORING_BANDS: [string, string][] = [
  ["feature-simple", "0-2 分：单点改动，需求清楚，低风险。"],
  ["feature-medium", "3-4 分：多文件或有设计取舍，但边界可控。"],
  ["feature-hard", "≥5 分：跨模块、高风险，需要架构师 agent 和明确用户抉择。"],
];

// skills list 不硬编码任何 skill，而是扫描本机标准 skill 安装目录，
// 解析每个 SKILL.md 的 frontmatter，返回真实可用的 skill 目录。
// 是否启用、必备还是可选，由模型读取目录后结合任务语义自行判断。
// 扫描来源（按优先级，靠前者覆盖靠后者的同名 skill）：
//   1. 当前插件自带 skills
//   2. Codex 项目级 ./.agents/skills
//   3. Codex 用户级 ~/.agents/skills
//   4. Claude 项目级 ./.claude/skills
//   5. Claude 用户级 ~/.claude/skills
//   6. Claude 已安装插件提供的 skill（依据 ~/.claude/plugins/installed_plugins.json）
const SKILL_SEARCH_ROOTS: [string, string][] = [
  [path.join(PLUGIN_ROOT, "skills"), "plugin:xft-comat"],
  [path.join(process.cwd(), ".agents", "skills"), "codex-project"],
  [path.join(os.homedir(), ".agents", "skills"), "codex-user"],
  [path.join(process.cwd(), ".claude", "skills"), "project"],
  [path.join(os.homedir(), ".claude", "skills"), "user"],
];

const INSTALLED_PLUGINS_FILE = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "installed_plugins.json",
);

interface StageItem {
  name: string;
  status: string;
}

interface Meta {
  mode: string;
  topic: string;
  summary: string;
  created_at: string;
  current_stage: string;
  stages: StageItem[];
  test_rounds: number;
}

interface SkillRecord {
  skill: string;
  scope: string;
  description: string;
  path: string;
}

// 等价于 Python 的 raise SystemExit(msg)：打印到 stderr 并以退出码 1 结束。
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// 复刻 Python json.dumps(ensure_ascii=False) 的紧凑分隔符（", " 与 ": "），
// 使无 indent 的输出与原脚本逐字节一致。带 indent 的输出 JSON.stringify 已等价。
function pyJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "[" + value.map(pyJSON).join(", ") + "]";
  const parts = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${JSON.stringify(k)}: ${pyJSON(v)}`,
  );
  return "{" + parts.join(", ") + "}";
}

function todayISO(): string {
  const d = new Date();
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  let v = value.trim().toLowerCase();
  v = v.replace(/[^a-z0-9一-鿿]+/g, "-");
  v = v.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return v.slice(0, 60) || "task";
}

function readTemplate(name: string): string {
  const p = path.join(TEMPLATE_ROOT, name);
  if (!existsSync(p)) {
    fail(`缺少模板：${p}`);
  }
  return readFileSync(p, "utf-8");
}

function writeTemplate(dest: string, templateName: string, values: Record<string, string>): void {
  let content = readTemplate(templateName);
  for (const [key, value] of Object.entries(values)) {
    content = content.replaceAll("{{" + key + "}}", value);
  }
  writeFileSync(dest, content, "utf-8");
}

function templateFor(doc: string): string {
  if (doc.endsWith("routing.md")) return "routing.md";
  if (doc.endsWith("requirements.md")) return "requirements.md";
  if (doc.endsWith("design-note.md")) return "design-note.md";
  if (doc.endsWith("design.md")) return "design.md";
  if (doc.endsWith("reproduction.md")) return "reproduction.md";
  if (doc.endsWith("root-cause.md")) return "root-cause.md";
  if (doc.endsWith("refactor-plan.md")) return "refactor-plan.md";
  if (doc.endsWith("safety-net.md")) return "safety-net.md";
  if (doc.includes("test-cases")) return "test-cases.md";
  if (doc.endsWith("state.md")) return "state.md";
  if (doc.endsWith("tasks.md")) return "tasks.md";
  if (doc.endsWith("skill-usage.md")) return "skill-usage.md";
  return fail(`没有匹配的模板：${doc}`);
}

function loadMeta(taskDir: string): Meta {
  const metaPath = path.join(taskDir, "workflow.json");
  if (!existsSync(metaPath)) {
    fail(`缺少 workflow.json：${taskDir}`);
  }
  return JSON.parse(readFileSync(metaPath, "utf-8")) as Meta;
}

function saveMeta(taskDir: string, meta: Meta): void {
  writeFileSync(
    path.join(taskDir, "workflow.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );
}

function cmdRoute(flags: Flags): void {
  // 代码不替模型做路由决策，只回显澄清后的任务并提供评判框架。
  // 模型应先完成公共的 receive/explore-and-clarify，再读取本输出判断 mode。
  const payload = {
    task: reqStr(flags, "task"),
    instructions:
      "仅在完成最小必要需求澄清后调用本命令。代码不对任务做关键词匹配或自动定级。请你阅读澄清后的 task，" +
      "先在 task_types 中判断任务类型，再用 complexity_dimensions 逐项自评" +
      "（每命中一项计 1 分），按 scoring_bands 得到 feature 的复杂度，" +
      "最后用判断出的 mode 调用 init。bugfix 与 refactor 优先于复杂度评分。",
    common_pre_route_stages: COMMON_PRE_ROUTE_STAGES,
    route_stage: ROUTE_STAGE,
    task_types: TASK_TYPES.map(([name, desc]) => ({ type: name, definition: desc })),
    complexity_dimensions: COMPLEXITY_DIMENSIONS.map(([name, desc]) => ({
      dimension: name,
      criterion: desc,
    })),
    scoring_bands: SCORING_BANDS.map(([mode, desc]) => ({ mode, band: desc })),
  };
  console.log(JSON.stringify(payload, null, 2));
}

function cmdInit(flags: Flags): void {
  const mode = reqStr(flags, "mode");
  if (!(mode in MODE_DOCS)) {
    fail(`未知工作流模式：${mode}`);
  }
  const topic = slugify(reqStr(flags, "topic"));
  const summary = reqStr(flags, "summary");
  const taskDir = path.join(WORKFLOW_ROOT, `${todayISO()}-${topic}`);
  if (existsSync(taskDir)) {
    fail(`任务目录已存在：${taskDir}`);
  }
  mkdirSync(taskDir, { recursive: true });
  const stages = MODE_STAGES[mode];
  const initialStage = stages[0];
  const stagesMarkdown = stages
    .map(
      (stage, index) =>
        `- [${index === 0 ? ">" : " "}] ${stage} — ${index === 0 ? "in_progress" : "pending"}`,
    )
    .join("\n");
  const values: Record<string, string> = {
    mode,
    topic,
    summary,
    date: todayISO(),
    current_stage: initialStage,
    stages_json: JSON.stringify(stages),
    stages_markdown: stagesMarkdown,
    round: "1",
    reason: "初始测试轮次",
  };
  for (const doc of MODE_DOCS[mode]) {
    writeTemplate(path.join(taskDir, doc), templateFor(doc), values);
  }
  const meta: Meta = {
    mode,
    topic,
    summary,
    created_at: todayISO(),
    current_stage: initialStage,
    stages: stages.map((stage) => ({ name: stage, status: "pending" })),
    test_rounds: 1,
  };
  meta.stages[0].status = "in_progress";
  saveMeta(taskDir, meta);
  console.log(taskDir);
}

function stateDocName(taskDir: string): string {
  for (const name of ["04-state.md", "05-state.md"]) {
    if (existsSync(path.join(taskDir, name))) {
      return name;
    }
  }
  return fail("找不到状态机文件");
}

function rewriteState(taskDir: string, meta: Meta): void {
  const lines = [
    `# 状态机：${meta.topic}`,
    "",
    `- 工作流模式：\`${meta.mode}\``,
    `- 当前阶段：\`${meta.current_stage}\``,
    "",
    "## 阶段",
  ];
  for (const item of meta.stages) {
    let marker = item.status === "completed" ? "x" : " ";
    if (item.status === "in_progress") {
      marker = ">";
    }
    lines.push(`- [${marker}] ${item.name} — ${item.status}`);
  }
  lines.push("");
  writeFileSync(path.join(taskDir, stateDocName(taskDir)), lines.join("\n"), "utf-8");
}

function cmdAdvance(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const stage = reqStr(flags, "stage");
  const meta = loadMeta(taskDir);
  const stageNames = meta.stages.map((item) => item.name);
  if (!stageNames.includes(stage)) {
    fail(`阶段不属于当前工作流：${stage}`);
  }
  for (const item of meta.stages) {
    if (item.name === stage) {
      item.status = "in_progress";
    } else if (stageNames.indexOf(item.name) < stageNames.indexOf(stage)) {
      item.status = "completed";
    }
  }
  meta.current_stage = stage;
  saveMeta(taskDir, meta);
  rewriteState(taskDir, meta);
  console.log(pyJSON({ current_stage: stage }));
}

function workflowDocs(taskDir: string): string[] {
  return readdirSync(taskDir)
    .filter((name) => name.endsWith(".md") && isFile(path.join(taskDir, name)))
    .sort()
    .map((name) => path.join(taskDir, name));
}

function validateReviewOrder(meta: Meta, errors: string[]): void {
  const pair = REVIEW_BEFORE_FINAL_VERIFY[meta.mode];
  if (!pair) {
    return;
  }
  const [reviewStage, finalVerifyStage] = pair;
  const names = (meta.stages ?? []).map((item) => item.name);
  if (!names.includes(reviewStage) || !names.includes(finalVerifyStage)) {
    errors.push(`状态机缺少审查或最终验证阶段：${reviewStage} / ${finalVerifyStage}`);
    return;
  }
  if (names.indexOf(reviewStage) > names.indexOf(finalVerifyStage)) {
    errors.push(`状态机顺序错误：${reviewStage} 必须早于 ${finalVerifyStage}`);
  }
}

function validateNoPlaceholders(taskDir: string, errors: string[]): void {
  for (const p of workflowDocs(taskDir)) {
    const content = readFileSync(p, "utf-8");
    for (const marker of PLACEHOLDER_MARKERS) {
      if (content.includes(marker)) {
        errors.push(`${path.basename(p)} 仍包含模板占位或未闭环标记：${marker}`);
      }
    }
  }
}

function validateRequiredParticipation(taskDir: string, meta: Meta, errors: string[]): void {
  const skillDoc = findSkillDoc(taskDir);
  if (!skillDoc) {
    errors.push("找不到 skill 使用记录文件");
    return;
  }
  const skillPath = path.join(taskDir, skillDoc);
  const content = readFileSync(skillPath, "utf-8");
  const usageMatch = content.match(/## 使用记录\n([\s\S]*?)(\n## |$)/);
  const usageSection = usageMatch ? usageMatch[1] : content;
  // 只结构化解析 record-skill 生成的记录行：- `skill` — 决策 — 原因[ — 证据：…]，
  // 按决策字段精确判断，避免把说明文字里出现的 "required" 误判为记录。
  const recordPattern = /^- `([^`]+)` — (\S+) — (.+)$/;
  for (const raw of usageSection.split("\n")) {
    const match = raw.trim().match(recordPattern);
    if (!match || match[2] !== "required") {
      continue;
    }
    const rest = match[3];
    if (!rest.includes("证据：") && !rest.includes("证据:")) {
      errors.push(`${path.basename(skillPath)} 的 required 记录缺少实质参与证据：${raw.trim()}`);
    }
  }

  if (meta.mode === "feature-hard") {
    const combined = workflowDocs(taskDir)
      .map((p) => readFileSync(p, "utf-8"))
      .join("\n");
    const expected = [
      "xft-comat:conductor",
      "xft-comat:architect",
      "xft-comat:tdd-engineer",
      "xft-comat:code-reviewer",
    ];
    for (const agentName of expected) {
      if (!combined.includes(agentName)) {
        errors.push(`feature-hard 缺少 specialist 参与或跳过原因记录：${agentName}`);
      }
    }
  }
}

function validateCloseReady(taskDir: string): string[] {
  const meta = loadMeta(taskDir);
  const errors: string[] = [];
  validateReviewOrder(meta, errors);
  validateNoPlaceholders(taskDir, errors);
  validateRequiredParticipation(taskDir, meta, errors);
  return errors;
}

function cmdValidate(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const errors = validateCloseReady(taskDir);
  const payload = { ok: errors.length === 0, errors };
  console.log(JSON.stringify(payload, null, 2));
  if (errors.length > 0) {
    process.exit(1);
  }
}

function cmdClose(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const errors = validateCloseReady(taskDir);
  if (errors.length > 0) {
    console.log(JSON.stringify({ closed: false, errors }, null, 2));
    process.exit(1);
  }
  const meta = loadMeta(taskDir);
  for (const item of meta.stages) {
    item.status = "completed";
  }
  meta.current_stage = "close";
  saveMeta(taskDir, meta);
  rewriteState(taskDir, meta);
  console.log(pyJSON({ closed: true, current_stage: "close" }));
}

function cmdSetDoc(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const doc = reqStr(flags, "doc");
  const target = path.join(taskDir, doc);
  if (!existsSync(target)) {
    fail(`目标文档不存在或不属于当前工作流：${target}`);
  }

  const fromFile = flags["from-file"];
  const hasContent = flags.content !== undefined;
  const useStdin = flags.stdin === true;
  const provided = [Boolean(fromFile), hasContent, useStdin].filter(Boolean).length;
  if (provided !== 1) {
    fail("set-doc 必须且只能提供 --from-file、--content、--stdin 之一");
  }

  if (fromFile) {
    const source = String(fromFile);
    if (!existsSync(source)) {
      fail(`来源文件不存在：${source}`);
    }
    copyFileSync(source, target);
  } else if (hasContent) {
    writeFileSync(target, String(flags.content), "utf-8");
  } else {
    writeFileSync(target, readFileSync(0, "utf-8"), "utf-8");
  }
  console.log(target);
}

// 从 SKILL.md 文本提取 YAML frontmatter 的 key: value。
// 支持单行值、续行，以及块标量（description: | / >）。
function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---")) {
    return {};
  }
  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return {};
  }
  const fields: Record<string, string> = {};
  let current: string | null = null;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") {
      break;
    }
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match && !(line.startsWith(" ") || line.startsWith("\t"))) {
      current = match[1];
      const value = match[2].trim();
      // | 或 > 开头（可带 -/+ chomping 指示符）表示块标量，值在后续缩进行。
      if (/^[|>][-+]?$/.test(value)) {
        fields[current] = "";
      } else {
        fields[current] = value;
      }
    } else if (current && line.trim()) {
      // 续行或块标量内容：追加到当前键。
      const sep = fields[current] ? " " : "";
      fields[current] = fields[current] + sep + line.trim();
    }
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    result[k] = v.trim().replace(/^['"]+|['"]+$/g, "");
  }
  return result;
}

// 从 installed_plugins.json 读取已安装插件，返回其 skills 目录及来源标签。
// 只纳入清单中列出的已安装插件，不扫描 marketplace 里未安装的插件。
function pluginSkillRoots(): [string, string][] {
  if (!isFile(INSTALLED_PLUGINS_FILE)) {
    return [];
  }
  let data: any;
  try {
    data = JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, "utf-8"));
  } catch {
    return [];
  }
  const roots: [string, string][] = [];
  const seen = new Set<string>();
  const plugins = (data && data.plugins) || {};
  for (const [pluginKey, records] of Object.entries(plugins)) {
    for (const record of (records as any[]) || []) {
      const installPath = record && record.installPath;
      if (!installPath || seen.has(installPath)) {
        continue;
      }
      seen.add(installPath);
      const skillsDir = path.join(installPath, "skills");
      if (isDir(skillsDir)) {
        roots.push([skillsDir, `plugin:${pluginKey}`]);
      }
    }
  }
  return roots;
}

// 扫描标准 skill 目录与已安装插件，解析 frontmatter，返回真实安装的 skill 列表。
function discoverSkills(): SkillRecord[] {
  const found = new Map<string, SkillRecord>();
  // 优先级：项目级 > 用户级 > 插件；先扫到的同名 skill 保留。
  for (const [root, scope] of [...SKILL_SEARCH_ROOTS, ...pluginSkillRoots()]) {
    if (!isDir(root)) {
      continue;
    }
    for (const entryName of readdirSync(root).sort()) {
      const entry = path.join(root, entryName);
      const skillMd = path.join(entry, "SKILL.md");
      if (!isFile(skillMd)) {
        continue;
      }
      const meta = parseFrontmatter(readFileSync(skillMd, "utf-8"));
      const name = meta.name || entryName;
      // 项目级优先：已存在则不被用户级覆盖。
      if (found.has(name)) {
        continue;
      }
      found.set(name, {
        skill: name,
        scope,
        description: meta.description || "",
        path: entry,
      });
    }
  }
  return [...found.values()].sort((a, b) => (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0));
}

function cmdSkillsList(): void {
  const skills = discoverSkills();
  const payload = {
    instructions:
      "以下是本机真实安装的 skill 目录（扫描当前插件 skills、Codex 项目级 .agents/skills、" +
      "Codex 用户级 ~/.agents/skills、Claude 项目级 .claude/skills、用户级 ~/.claude/skills，" +
      "以及 Claude installed_plugins.json 中已安装插件提供的 skills，解析每个 SKILL.md " +
      "frontmatter 得到；scope 字段标明来源，plugin:<key> 表示插件）。" +
      "代码不做 skill 匹配，请你结合任务语义判断哪些 skill 与当前任务相关、" +
      "各属 required 还是 optional，再用 record-skill 记录决策。涉及 UI 流程或浏览器 " +
      "E2E 时，若目录中存在 agent-browser 则按 SKILL.md 约定记为 required。",
    count: skills.length,
    available_skills: skills,
  };
  console.log(JSON.stringify(payload, null, 2));
}

function findSkillDoc(taskDir: string): string | null {
  for (const name of ["06-skill-usage.md", "07-skill-usage.md"]) {
    if (existsSync(path.join(taskDir, name))) {
      return name;
    }
  }
  return null;
}

function skillDocName(taskDir: string): string {
  const name = findSkillDoc(taskDir);
  if (!name) {
    return fail("找不到 skill 使用记录文件");
  }
  return name;
}

const USAGE_HEADING = "## 使用记录";

function cmdRecordSkill(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const skill = reqStr(flags, "skill");
  const decision = reqChoice(flags, "decision", ["accepted", "declined", "required", "skipped"]);
  const reason = reqStr(flags, "reason");
  const evidenceArg = flags.evidence === undefined ? "" : String(flags.evidence);
  const p = path.join(taskDir, skillDocName(taskDir));
  const evidence = evidenceArg ? ` — 证据：${evidenceArg}` : "";
  const recordLine = `- \`${skill}\` — ${decision} — ${reason}${evidence}`;
  let content = readFileSync(p, "utf-8");
  const headingAt = content.indexOf(USAGE_HEADING);
  if (headingAt === -1) {
    // 找不到使用记录章节时回退到文件末尾追加，保证记录不丢失。
    content = content.replace(/\n+$/, "") + `\n${recordLine}\n`;
  } else {
    // 插入到「使用记录」章节末尾（下一个二级标题之前或文件末尾），
    // 这样记录始终落在 validate 扫描的章节内，与章节在文件中的位置无关。
    const nextHeading = content.indexOf("\n## ", headingAt + USAGE_HEADING.length);
    const sectionEnd = nextHeading === -1 ? content.length : nextHeading;
    const before = content.slice(0, sectionEnd).replace(/\n+$/, "");
    const after = content.slice(sectionEnd);
    content = `${before}\n${recordLine}\n${after}`;
  }
  writeFileSync(p, content, "utf-8");
  console.log(p);
}

function nextTestDoc(taskDir: string, roundNumber: number): string {
  const docs = readdirSync(taskDir)
    .filter((name) => name.includes("test-cases-round-") && name.endsWith(".md"))
    .sort();
  if (docs.length === 0) {
    fail("找不到测试用例文档");
  }
  const prefix = docs[0].split("test-cases-round-")[0];
  return path.join(taskDir, `${prefix}test-cases-round-${roundNumber}.md`);
}

function cmdNewTestRound(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const reason = reqStr(flags, "reason");
  const meta = loadMeta(taskDir);
  meta.test_rounds = Number(meta.test_rounds ?? 1) + 1;
  saveMeta(taskDir, meta);
  const values: Record<string, string> = {
    mode: meta.mode,
    topic: meta.topic,
    summary: meta.summary,
    date: todayISO(),
    round: String(meta.test_rounds),
    reason,
  };
  const p = nextTestDoc(taskDir, meta.test_rounds);
  writeTemplate(p, "test-cases.md", values);
  console.log(p);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cmdCheckTest(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const round = reqInt(flags, "round");
  const caseName = reqStr(flags, "case");
  const status = reqChoice(flags, "status", ["passed", "failed"]);
  const note = flags.note === undefined ? "" : String(flags.note);
  const p = nextTestDoc(taskDir, round);
  if (!existsSync(p)) {
    fail(`测试轮次不存在：${p}`);
  }
  const content = readFileSync(p, "utf-8");
  const passed = status === "passed";
  const statusText = passed ? "通过" : "未通过";
  const mark = passed ? "x" : " ";
  const pattern = new RegExp(
    `(- \\[)[ x](\\] ${escapeRegExp(caseName)} .*?— )(待验证|通过|未通过)(.*)`,
    "g",
  );
  let count = 0;
  let newContent = content.replace(pattern, (_m, g1, g2, _g3, g4) => {
    count += 1;
    return `${g1}${mark}${g2}${statusText}${g4}`;
  });
  if (count === 0) {
    newContent += `\n- [${passed ? "x" : " "}] ${caseName} — ${statusText} — ${note}\n`;
  }
  writeFileSync(p, newContent, "utf-8");
  console.log(p);
}

// ---- 轻量参数解析（替代 Python argparse，零依赖）----

type Flags = Record<string, string | boolean | undefined>;

interface ParseOptions {
  booleanKeys?: string[];
  allowedKeys?: string[];
}

function parseFlags(argv: string[], options: ParseOptions = {}): Flags {
  const flags: Flags = {};
  const booleans = new Set(options.booleanKeys ?? []);
  const allowed = options.allowedKeys ? new Set(options.allowedKeys) : null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--help" || tok === "-h") {
      flags.help = true;
      continue;
    }
    if (tok.startsWith("--")) {
      const eqAt = tok.indexOf("=");
      const key = eqAt === -1 ? tok.slice(2) : tok.slice(2, eqAt);
      if (allowed && !allowed.has(key)) {
        fail(`无法识别的参数：--${key}`);
      }
      if (booleans.has(key)) {
        if (eqAt !== -1) {
          fail(`参数 --${key} 不接受取值`);
        }
        flags[key] = true;
      } else {
        if (eqAt !== -1) {
          flags[key] = tok.slice(eqAt + 1);
        } else {
          const value = argv[++i];
          if (value === undefined || value.startsWith("--")) {
            fail(`参数 --${key} 需要取值`);
          }
          flags[key] = value;
        }
      }
    } else {
      fail(`无法识别的参数：${tok}`);
    }
  }
  return flags;
}

function reqStr(flags: Flags, name: string): string {
  const value = flags[name];
  if (value === undefined || typeof value !== "string") {
    fail(`缺少必填参数：--${name}`);
  }
  return value as string;
}

function reqInt(flags: Flags, name: string): number {
  const raw = reqStr(flags, name);
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    fail(`参数 --${name} 需要整数：${raw}`);
  }
  return n;
}

function reqChoice(flags: Flags, name: string, choices: string[]): string {
  const value = reqStr(flags, name);
  if (!choices.includes(value)) {
    fail(`参数 --${name} 取值无效：${value}（可选：${choices.join(", ")}）`);
  }
  return value;
}

const HELP = `维护 .xft-comat 的轻量程序入口

用法：
  workflowctl.ts <子命令> [参数]

子命令：
  route --task <task>
  init --topic <topic> --mode <mode> --summary <summary>
  advance --task-dir <dir> --stage <stage>
  validate --task-dir <dir>
  close --task-dir <dir>
  set-doc --task-dir <dir> --doc <doc> (--from-file <file> | --content <text> | --stdin)
  skills list
  record-skill --task-dir <dir> --skill <skill> --decision <decision> --reason <reason> [--evidence <text>]
  new-test-round --task-dir <dir> --reason <reason>
  check-test --task-dir <dir> --round <n> --case <case> --status <passed|failed> [--note <text>]
`;

function showHelp(): void {
  console.log(HELP);
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    showHelp();
    return;
  }
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    showHelp();
    return;
  }
  switch (command) {
    case "route":
      cmdRoute(parseFlags(rest, { allowedKeys: ["task"] }));
      break;
    case "init":
      cmdInit(parseFlags(rest, { allowedKeys: ["topic", "mode", "summary"] }));
      break;
    case "advance":
      cmdAdvance(parseFlags(rest, { allowedKeys: ["task-dir", "stage"] }));
      break;
    case "validate":
      cmdValidate(parseFlags(rest, { allowedKeys: ["task-dir"] }));
      break;
    case "close":
      cmdClose(parseFlags(rest, { allowedKeys: ["task-dir"] }));
      break;
    case "set-doc":
      cmdSetDoc(parseFlags(rest, {
        booleanKeys: ["stdin"],
        allowedKeys: ["task-dir", "doc", "from-file", "content", "stdin"],
      }));
      break;
    case "skills": {
      if (rest[0] !== "list") {
        fail("skills 仅支持子命令：list");
      }
      parseFlags(rest.slice(1), { allowedKeys: [] });
      cmdSkillsList();
      break;
    }
    case "record-skill":
      cmdRecordSkill(parseFlags(rest, {
        allowedKeys: ["task-dir", "skill", "decision", "reason", "evidence"],
      }));
      break;
    case "new-test-round":
      cmdNewTestRound(parseFlags(rest, { allowedKeys: ["task-dir", "reason"] }));
      break;
    case "check-test":
      cmdCheckTest(parseFlags(rest, {
        allowedKeys: ["task-dir", "round", "case", "status", "note"],
      }));
      break;
    default:
      fail(`未知子命令：${command}`);
  }
}

main();
