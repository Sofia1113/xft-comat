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

const ATOMIC_STAGE_DEFINITIONS: [string, string][] = [
  ["receive", "接收任务，做最小可见前导。"],
  ["explore-and-clarify", "并行轻量探索代码与逐轮澄清需求。"],
  ["route", "澄清后确认最终 workflow mode 并记录路由理由。"],
  ["investigate", "建立问题复现、根因证据或重构行为基线。"],
  ["plan", "沉淀设计、修复策略、重构方案、测试策略和任务拆分。"],
  ["decide", "需要用户拍板时记录选项、取舍和最终抉择。"],
  ["implement", "测试先行或补齐保护后完成最小实现。"],
  ["verify", "运行基础冒烟测试，确认代码可审查；不替代代码审查，也不做完整 E2E。"],
  ["review", "在 final-verify 前完成代码审查。"],
  ["fix", "闭环审查发现、补回归测试并复跑受影响验证。"],
  ["final-verify", "审查修复后执行最终自动化验证、E2E 回归或等价验证。"],
  ["close", "检查记录并收尾交付。"],
];

const STAGE = Object.fromEntries(ATOMIC_STAGE_DEFINITIONS.map(([name]) => [name, name])) as Record<string, string>;

const COMMON_PRE_ROUTE_STAGES = [STAGE.receive, STAGE["explore-and-clarify"]];
const ROUTE_STAGE = STAGE.route;

const MODE_STAGE_TAILS: Record<string, string[]> = {
  "feature-simple": [
    STAGE.plan,
    STAGE.implement,
    STAGE.verify,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  "feature-medium": [
    STAGE.plan,
    STAGE.implement,
    STAGE.verify,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  "feature-hard": [
    STAGE.investigate,
    STAGE.decide,
    STAGE.plan,
    STAGE.implement,
    STAGE.verify,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  bugfix: [
    STAGE.investigate,
    STAGE.plan,
    STAGE.implement,
    STAGE.verify,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  refactor: [
    STAGE.investigate,
    STAGE.plan,
    STAGE.implement,
    STAGE.verify,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
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

// feature-hard 必须有结构化参与记录的 specialist（裸 agent 名，不耦合插件作用域前缀）。
const REQUIRED_HARD_AGENTS = ["conductor", "architect", "tdd-engineer", "code-reviewer"];

const REVIEW_BEFORE_FINAL_VERIFY: Record<string, [string, string]> = {
  "feature-simple": [STAGE.review, STAGE["final-verify"]],
  "feature-medium": [STAGE.review, STAGE["final-verify"]],
  "feature-hard": [STAGE.review, STAGE["final-verify"]],
  bugfix: [STAGE.review, STAGE["final-verify"]],
  refactor: [STAGE.review, STAGE["final-verify"]],
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

interface TaskItem {
  id: string;
  title: string;
  owner: string;
  kind: string;
  status: string;
  deps?: string;
  evidence?: string;
}

interface AgentRecord {
  agent: string;
  decision: string;
  evidence?: string;
  reason?: string;
}

interface Meta {
  mode: string;
  topic: string;
  summary: string;
  created_at: string;
  current_stage: string;
  stages: StageItem[];
  test_rounds: number;
  tasks: TaskItem[];
  agents: AgentRecord[];
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
    atomic_stages: ATOMIC_STAGE_DEFINITIONS.map(([stage, definition]) => ({ stage, definition })),
    mode_stage_tails: MODE_STAGE_TAILS,
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
    tasks: [],
    agents: [],
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
  const targetIndex = stageNames.indexOf(stage);
  if (targetIndex === -1) {
    fail(`阶段不属于当前工作流：${stage}`);
  }
  const currentIndex = stageNames.indexOf(meta.current_stage);
  // 阶段守卫：向前推进时不得跳过任何未完成（pending）的实质阶段，
  // 从而把“审查早于 final-verify”等顺序约束变成程序门禁，而非仅靠模型自觉。
  // 公共前置阶段（route 之前的 receive/explore-and-clarify）允许在 init 后被一次性
  // 跳过——澄清先行，它们在调用 init 之前已由主会话完成；守卫只覆盖 route 及其之后。
  // 回退到更早阶段重做不受守卫限制。
  if (targetIndex > currentIndex) {
    const routeIndex = stageNames.indexOf(ROUTE_STAGE);
    const guardStart = routeIndex === -1 ? 0 : routeIndex;
    for (let i = guardStart; i < targetIndex; i++) {
      if (meta.stages[i].status === "pending") {
        fail(
          `无法推进到 ${stage}：实质阶段 ${meta.stages[i].name} 仍未完成（pending），不能跳过。` +
            `请先 advance --stage ${meta.stages[i].name} 逐阶段推进。`,
        );
      }
    }
  }
  // 目标之前标 completed，目标标 in_progress，目标之后重置为 pending。
  // 前进时目标之后本就是 pending；回退重做时借此清除后续阶段过期的完成状态。
  for (const [index, item] of meta.stages.entries()) {
    if (index < targetIndex) {
      item.status = "completed";
    } else if (index === targetIndex) {
      item.status = "in_progress";
    } else {
      item.status = "pending";
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
    // 从结构化 record-agent 记录判断，而非字符串包含 agent 名（避免“写了名字但标注未参与”蒙混）。
    const byAgent = new Map((meta.agents ?? []).map((rec) => [rec.agent, rec]));
    for (const name of REQUIRED_HARD_AGENTS) {
      const rec = byAgent.get(name);
      if (!rec) {
        errors.push(`feature-hard 必须用 record-agent 记录 specialist 参与或跳过原因：缺 ${name}`);
      } else if (rec.decision === "participated" && !rec.evidence) {
        errors.push(`${name} 记录为 participated 但缺少实质参与证据`);
      } else if (rec.decision === "skipped" && !rec.reason) {
        errors.push(`${name} 记录为 skipped 但缺少未使用原因`);
      }
    }
  }
}

// 与 check-test 同源：状态词紧跟用例名后的首个 “— ”；非贪婪 + 前瞻避免误吃描述里的破折号。
const TEST_CASE_LINE = /^- \[[ x]\] (.+?) — (待验证|通过|未通过)(?=\s|—|$)/;

interface TestCaseStatus {
  name: string;
  status: string;
}

// 按 meta.test_rounds 定位最新一轮测试用例文档；找不到返回 null。
function latestTestRoundPath(taskDir: string, meta: Meta): string | null {
  const roundDocs = readdirSync(taskDir).filter(
    (name) => name.includes("test-cases-round-") && name.endsWith(".md"),
  );
  if (roundDocs.length === 0) {
    return null;
  }
  // 各轮文档前缀一致（如 "03-"/"04-"），取任意一个即可拼出最新一轮文件名。
  const prefix = roundDocs[0].split("test-cases-round-")[0];
  const round = Number(meta.test_rounds ?? 1);
  const p = path.join(taskDir, `${prefix}test-cases-round-${round}.md`);
  return existsSync(p) ? p : null;
}

// 只解析“测试矩阵”章节里的用例行，避免“失败记录”等自由文本里的状态词造成误判。
function parseTestMatrix(docPath: string): TestCaseStatus[] {
  const content = readFileSync(docPath, "utf-8");
  const matrixMatch = content.match(/## 测试矩阵\n([\s\S]*?)(\n## |$)/);
  const matrix = matrixMatch ? matrixMatch[1] : content;
  const cases: TestCaseStatus[] = [];
  for (const raw of matrix.split("\n")) {
    const m = raw.trim().match(TEST_CASE_LINE);
    if (m) {
      cases.push({ name: m[1].trim(), status: m[2] });
    }
  }
  return cases;
}

// 测试用例闭环：最新一轮的用例不得残留 `待验证`（从未跑）或 `未通过`（失败未修）。
// 呼应需求“测试通过的用例需要打勾，未通过需打回；多少轮就保留多少个文档”：
// 只检查最新一轮，失败应通过 new-test-round 开新一轮重新打勾，历史轮保留作审计轨迹。
function validateTestClosure(taskDir: string, meta: Meta, errors: string[]): void {
  const docPath = latestTestRoundPath(taskDir, meta);
  if (!docPath) {
    errors.push("找不到测试用例文档");
    return;
  }
  const cases = parseTestMatrix(docPath);
  const pending = cases.filter((c) => c.status === "待验证").map((c) => c.name);
  const failed = cases.filter((c) => c.status === "未通过").map((c) => c.name);
  const base = path.basename(docPath);
  if (pending.length > 0) {
    errors.push(
      `${base} 仍有未验证（待验证）的测试用例：${pending.join("、")}；` +
        `close 前必须跑测试并用 check-test 打勾。`,
    );
  }
  if (failed.length > 0) {
    errors.push(
      `${base} 仍有未通过的测试用例：${failed.join("、")}；` +
        `必须修复并复跑转绿，失败假设变化时用 new-test-round 开新一轮记录。`,
    );
  }
}

// 任务归属：feature-hard 必须用 add-task 登记结构化任务；任何被登记的实现类任务
// owner 都不得是主会话（主会话只做编排、澄清、拍板与证据核验）。
function validateTaskOwnership(meta: Meta, errors: string[]): void {
  const tasks = meta.tasks ?? [];
  if (meta.mode === "feature-hard" && tasks.length === 0) {
    errors.push("feature-hard 必须用 add-task 登记结构化任务（含 owner 与状态），不能只手写任务文档。");
    return;
  }
  for (const task of tasks) {
    const kind = task.kind ?? "implementation";
    if (kind === "implementation" && isMainSessionOwner(task.owner)) {
      errors.push(
        `${task.id} 是实现类任务，owner 不得为主会话（当前：${task.owner}）；` +
          `实现/测试/前端落地/审查修复必须分派给 specialist。`,
      );
    }
  }
}

function validateCloseReady(taskDir: string): string[] {
  const meta = loadMeta(taskDir);
  const errors: string[] = [];
  validateReviewOrder(meta, errors);
  validateNoPlaceholders(taskDir, errors);
  validateRequiredParticipation(taskDir, meta, errors);
  validateTestClosure(taskDir, meta, errors);
  validateTaskOwnership(meta, errors);
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

// 只读聚合：一条命令返回工作流全貌（阶段、任务、测试、文档占位、收尾阻塞），
// 让模型快速对齐当前进度，减少逐个读 .xft-comat 文档（呼应轻量上下文策略）。
function cmdStatus(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const meta = loadMeta(taskDir);
  const docs = workflowDocs(taskDir).map((p) => {
    const content = readFileSync(p, "utf-8");
    return {
      doc: path.basename(p),
      has_placeholder: PLACEHOLDER_MARKERS.some((marker) => content.includes(marker)),
    };
  });
  const testDoc = latestTestRoundPath(taskDir, meta);
  const cases = testDoc ? parseTestMatrix(testDoc) : [];
  const latestTestRound = testDoc
    ? {
        round: Number(meta.test_rounds ?? 1),
        doc: path.basename(testDoc),
        total: cases.length,
        passed: cases.filter((c) => c.status === "通过").length,
        failed: cases.filter((c) => c.status === "未通过").length,
        pending: cases.filter((c) => c.status === "待验证").length,
      }
    : null;
  const tasks = meta.tasks ?? [];
  const blockers = validateCloseReady(taskDir);
  const payload = {
    task_dir: taskDir,
    mode: meta.mode,
    topic: meta.topic,
    current_stage: meta.current_stage,
    stages: meta.stages.map((s) => ({ name: s.name, status: s.status })),
    tasks: {
      total: tasks.length,
      done: tasks.filter((t) => t.status === "done").length,
      items: tasks.map((t) => ({ id: t.id, owner: t.owner, kind: t.kind, status: t.status })),
    },
    test_rounds: Number(meta.test_rounds ?? 1),
    latest_test_round: latestTestRound,
    docs,
    close_blockers: blockers,
    ready_to_close: blockers.length === 0,
  };
  console.log(JSON.stringify(payload, null, 2));
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

// 校验拟记为 required 的 skill 是否真实安装；缺失时退出码 1 并提示阻塞/改派，
// 避免主会话在 required skill 不可用时静默顶替其职责。
function cmdSkillsCheck(flags: Flags): void {
  const requireArg = reqStr(flags, "require");
  const required = requireArg
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (required.length === 0) {
    fail("skills check 需要 --require <name>[,<name>...]");
  }
  const byName = new Map(discoverSkills().map((rec) => [rec.skill, rec]));
  const results = required.map((name) => {
    const rec = byName.get(name);
    return rec
      ? { skill: name, status: "installed", scope: rec.scope, path: rec.path }
      : { skill: name, status: "missing", scope: null, path: null };
  });
  const missing = results.filter((r) => r.status === "missing").map((r) => r.skill);
  const payload = {
    ok: missing.length === 0,
    required,
    results,
    missing,
    instructions:
      missing.length === 0
        ? "全部 required skill 已安装；按 SKILL.md 记录为 required，并在使用后补入实质参与证据。"
        : "存在未安装的 required skill：不得由主会话静默顶替其职责。请在 skill-usage 记录为阻塞，" +
          "改派能承担该职责的 specialist，或与用户确认降级方案后再继续。",
  };
  console.log(JSON.stringify(payload, null, 2));
  if (missing.length > 0) {
    process.exit(1);
  }
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

// ---- 结构化 specialist 参与记录（meta.agents 为真源，渲染到 skill-usage 的 Agent 区）----

const AGENT_DECISIONS = ["participated", "skipped"];
const AGENT_SECTION_HEADING = "## Agent 参与记录";

function renderAgentLine(rec: AgentRecord): string {
  const tail =
    rec.decision === "participated" ? ` — 证据：${rec.evidence ?? ""}` : ` — 原因：${rec.reason ?? ""}`;
  return `- \`${rec.agent}\` — ${rec.decision}${tail}`;
}

// 用 meta.agents 整体重渲染 skill-usage 的「Agent 参与记录」区（替换该区，不碰其它区）。
function rewriteAgentSection(taskDir: string, meta: Meta): void {
  const skillDoc = findSkillDoc(taskDir);
  if (!skillDoc) {
    return;
  }
  const p = path.join(taskDir, skillDoc);
  let content = readFileSync(p, "utf-8");
  const headingAt = content.indexOf(AGENT_SECTION_HEADING);
  if (headingAt === -1) {
    return;
  }
  const nextHeading = content.indexOf("\n## ", headingAt + AGENT_SECTION_HEADING.length);
  const sectionEnd = nextHeading === -1 ? content.length : nextHeading;
  const records = meta.agents ?? [];
  const body = records.length
    ? records.map(renderAgentLine).join("\n")
    : "暂无 agent 参与记录，使用 record-agent 登记。";
  const newSection = `${AGENT_SECTION_HEADING}\n\n${body}\n`;
  content = content.slice(0, headingAt) + newSection + content.slice(sectionEnd);
  writeFileSync(p, content, "utf-8");
}

function cmdRecordAgent(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const agent = reqStr(flags, "agent");
  const decision = reqChoice(flags, "decision", AGENT_DECISIONS);
  const evidence = flags.evidence === undefined ? "" : String(flags.evidence);
  const reason = flags.reason === undefined ? "" : String(flags.reason);
  if (decision === "participated" && !evidence) {
    fail("record-agent participated 必须提供 --evidence（实质参与证据）");
  }
  if (decision === "skipped" && !reason) {
    fail("record-agent skipped 必须提供 --reason（未使用原因）");
  }
  const meta = loadMeta(taskDir);
  meta.agents = meta.agents ?? [];
  const record: AgentRecord = { agent, decision };
  if (evidence) {
    record.evidence = evidence;
  }
  if (reason) {
    record.reason = reason;
  }
  const idx = meta.agents.findIndex((rec) => rec.agent === agent);
  if (idx >= 0) {
    meta.agents[idx] = record;
  } else {
    meta.agents.push(record);
  }
  saveMeta(taskDir, meta);
  rewriteAgentSection(taskDir, meta);
  console.log(pyJSON({ agent, decision }));
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

// ---- 结构化任务列表（tasks 文档由 meta.tasks 渲染，与 state.md 同源）----

const TASK_STATUSES = ["todo", "doing", "done", "blocked"];
const TASK_KINDS = ["implementation", "coordination"];

function findTasksDoc(taskDir: string): string {
  for (const name of ["05-tasks.md", "06-tasks.md"]) {
    if (existsSync(path.join(taskDir, name))) {
      return name;
    }
  }
  return fail("找不到任务列表文件");
}

// hard 流程实现类任务的 owner 不得是主会话；归一化后匹配常见写法。
function isMainSessionOwner(owner: string): boolean {
  const norm = owner.toLowerCase().replace(/\s+/g, "");
  return (
    norm.includes("主会话") ||
    norm.includes("主claude") ||
    norm.includes("mainsession") ||
    norm.includes("mainclaude") ||
    norm === "main" ||
    norm === "主"
  );
}

function nextTaskId(tasks: TaskItem[]): string {
  let max = 0;
  for (const task of tasks) {
    const m = task.id.match(/(\d+)\s*$/);
    if (m) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return `TASK-${String(max + 1).padStart(3, "0")}`;
}

function renderTaskLine(task: TaskItem): string {
  const mark = task.status === "done" ? "x" : " ";
  const parts = [
    `- [${mark}] ${task.id} — ${task.title}`,
    `owner：${task.owner}`,
    `状态：${task.status}`,
    `类型：${task.kind}`,
  ];
  if (task.deps) {
    parts.push(`依赖：${task.deps}`);
  }
  if (task.evidence) {
    parts.push(`验收证据：${task.evidence}`);
  }
  return parts.join(" — ");
}

function rewriteTasks(taskDir: string, meta: Meta): void {
  const tasks = meta.tasks ?? [];
  const lines = [
    `# 实现任务列表：${meta.topic}`,
    "",
    `- 日期：${meta.created_at}`,
    `- 工作流模式：\`${meta.mode}\``,
    "",
    "## 任务",
    "",
  ];
  if (tasks.length === 0) {
    lines.push("暂无任务，使用 add-task 登记任务拆分、owner 与状态。");
  } else {
    for (const task of tasks) {
      lines.push(renderTaskLine(task));
    }
  }
  // “完成定义”章节沿用模板，保持单一真源。
  const tpl = readTemplate("tasks.md");
  const defAt = tpl.indexOf("## 完成定义");
  const completion = defAt === -1 ? "" : tpl.slice(defAt).replace(/\s+$/, "");
  const out = lines.join("\n") + (completion ? "\n\n" + completion + "\n" : "\n");
  writeFileSync(path.join(taskDir, findTasksDoc(taskDir)), out, "utf-8");
}

function cmdAddTask(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const title = reqStr(flags, "title");
  const owner = reqStr(flags, "owner");
  const kind = flags.kind === undefined ? "implementation" : reqChoice(flags, "kind", TASK_KINDS);
  const status = flags.status === undefined ? "todo" : reqChoice(flags, "status", TASK_STATUSES);
  const meta = loadMeta(taskDir);
  meta.tasks = meta.tasks ?? [];
  const id = flags.id === undefined ? nextTaskId(meta.tasks) : String(flags.id);
  if (meta.tasks.some((task) => task.id === id)) {
    fail(`任务 id 已存在：${id}（用 set-task 更新现有任务）`);
  }
  const task: TaskItem = { id, title, owner, kind, status };
  if (flags.deps !== undefined) {
    task.deps = String(flags.deps);
  }
  if (flags.evidence !== undefined) {
    task.evidence = String(flags.evidence);
  }
  meta.tasks.push(task);
  saveMeta(taskDir, meta);
  rewriteTasks(taskDir, meta);
  console.log(pyJSON({ id, owner, kind, status }));
}

function cmdSetTask(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const id = reqStr(flags, "id");
  const meta = loadMeta(taskDir);
  meta.tasks = meta.tasks ?? [];
  const task = meta.tasks.find((item) => item.id === id);
  if (!task) {
    fail(`找不到任务：${id}（用 add-task 新增）`);
  }
  if (flags.title !== undefined) {
    task.title = String(flags.title);
  }
  if (flags.owner !== undefined) {
    task.owner = String(flags.owner);
  }
  if (flags.kind !== undefined) {
    task.kind = reqChoice(flags, "kind", TASK_KINDS);
  }
  if (flags.status !== undefined) {
    task.status = reqChoice(flags, "status", TASK_STATUSES);
  }
  if (flags.deps !== undefined) {
    task.deps = String(flags.deps);
  }
  if (flags.evidence !== undefined) {
    task.evidence = String(flags.evidence);
  }
  saveMeta(taskDir, meta);
  rewriteTasks(taskDir, meta);
  console.log(pyJSON({ id: task.id, owner: task.owner, kind: task.kind, status: task.status }));
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
  status --task-dir <dir>
  close --task-dir <dir>
  set-doc --task-dir <dir> --doc <doc> (--from-file <file> | --content <text> | --stdin)
  skills list
  skills check --require <name>[,<name>...]
  record-skill --task-dir <dir> --skill <skill> --decision <decision> --reason <reason> [--evidence <text>]
  record-agent --task-dir <dir> --agent <agent> --decision <participated|skipped> [--evidence <text>] [--reason <text>]
  add-task --task-dir <dir> --title <title> --owner <owner> [--id <id>] [--kind implementation|coordination] [--status todo|doing|done|blocked] [--deps <text>] [--evidence <text>]
  set-task --task-dir <dir> --id <id> [--title <text>] [--owner <text>] [--kind <kind>] [--status <status>] [--deps <text>] [--evidence <text>]
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
    case "status":
      cmdStatus(parseFlags(rest, { allowedKeys: ["task-dir"] }));
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
      const sub = rest[0];
      if (sub === "list") {
        parseFlags(rest.slice(1), { allowedKeys: [] });
        cmdSkillsList();
      } else if (sub === "check") {
        cmdSkillsCheck(parseFlags(rest.slice(1), { allowedKeys: ["require"] }));
      } else {
        fail("skills 仅支持子命令：list、check");
      }
      break;
    }
    case "record-skill":
      cmdRecordSkill(parseFlags(rest, {
        allowedKeys: ["task-dir", "skill", "decision", "reason", "evidence"],
      }));
      break;
    case "record-agent":
      cmdRecordAgent(parseFlags(rest, {
        allowedKeys: ["task-dir", "agent", "decision", "evidence", "reason"],
      }));
      break;
    case "add-task":
      cmdAddTask(parseFlags(rest, {
        allowedKeys: ["task-dir", "title", "owner", "id", "kind", "status", "deps", "evidence"],
      }));
      break;
    case "set-task":
      cmdSetTask(parseFlags(rest, {
        allowedKeys: ["task-dir", "id", "title", "owner", "kind", "status", "deps", "evidence"],
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
