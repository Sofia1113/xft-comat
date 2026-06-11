#!/usr/bin/env node
// 轻量工作流目录维护工具。
//
// 用 Node 驱动（无需 Python）：依赖 Node 内置 TypeScript type stripping，
// 直接 `node workflowctl.ts <command> ...` 即可运行。
//   - Node ≥ 22.18 / ≥ 23.6：默认启用，无需任何 flag。
//   - Node 22.6 – 22.17：需加 `--experimental-strip-types`。
// 仅使用 node: 内置模块，不引入任何第三方依赖。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const WORKFLOW_ROOT = path.join(ROOT, ".xft-comat");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
// scripts/workflowctl.ts -> 上一层是 workflow/pilot。
const WORKFLOW_RUNTIME_ROOT = path.dirname(SCRIPT_DIR);
const PLUGIN_ROOT = path.dirname(path.dirname(WORKFLOW_RUNTIME_ROOT));
const TEMPLATE_ROOT = path.join(WORKFLOW_RUNTIME_ROOT, "templates");

// 各模式 init 时创建的文档。测试用例文档不在 init 时预生成——由实现/验证 agent
// 在设计用例时用 new-test-round 创建第 1 轮，文档诞生时间与内容产生时间对齐。
const MODE_DOCS: Record<string, string[]> = {
  "feature-simple": [
    "00-routing.md",
    "01-requirements.md",
    "02-design-note.md",
    "04-state.md",
    "05-tasks.md",
    "06-skill-usage.md",
    "07-review.md",
  ],
  "feature-medium": [
    "00-routing.md",
    "01-requirements.md",
    "02-design.md",
    "04-state.md",
    "05-tasks.md",
    "06-skill-usage.md",
    "07-review.md",
  ],
  "feature-hard": [
    "00-routing.md",
    "01-requirements.md",
    "02-design.md",
    "04-state.md",
    "05-tasks.md",
    "06-skill-usage.md",
    "07-review.md",
  ],
  bugfix: [
    "00-routing.md",
    "01-requirements.md",
    "02-reproduction.md",
    "03-root-cause.md",
    "05-state.md",
    "06-tasks.md",
    "07-skill-usage.md",
    "08-review.md",
  ],
  refactor: [
    "00-routing.md",
    "01-requirements.md",
    "02-refactor-plan.md",
    "03-safety-net.md",
    "05-state.md",
    "06-tasks.md",
    "07-skill-usage.md",
    "08-review.md",
  ],
};

// 各模式测试用例文档的序号前缀（new-test-round 创建首轮时使用）。
const TEST_DOC_PREFIX: Record<string, string> = {
  "feature-simple": "03-",
  "feature-medium": "03-",
  "feature-hard": "03-",
  bugfix: "04-",
  refactor: "04-",
};

// 原子阶段：5 种 workflow 只从这组阶段拼接，不另造阶段名。
// 接收/探索/澄清/路由发生在 init 之前，由 pilot 主会话直接驱动，不进入状态机
// （留痕在 00-routing.md / 01-requirements.md），避免账面虚构阶段。
// verify 已并入 implement（实现 agent 必须自带基础验证），不再单独分派。
const ATOMIC_STAGE_DEFINITIONS: [string, string][] = [
  ["investigate", "建立问题复现、根因证据或重构行为基线。"],
  ["plan", "沉淀设计、修复策略、重构方案、测试策略和任务拆分。"],
  ["decide", "主会话就设计文档列出的关键取舍逐个向用户拿到拍板结论。"],
  ["implement", "测试先行或补齐保护后完成最小实现，并运行基础验证到可审查状态。"],
  ["review", "在 final-verify 前完成代码审查，并用 record-review 落库审查结论。"],
  ["fix", "闭环审查发现、补回归测试并复跑受影响验证（review 无阻塞发现时自动跳过）。"],
  ["final-verify", "审查修复后执行最终自动化验证、E2E 回归或等价验证。"],
  ["close", "检查记录并收尾交付。"],
];

const STAGE = Object.fromEntries(ATOMIC_STAGE_DEFINITIONS.map(([name]) => [name, name])) as Record<string, string>;

// 各模式阶段序列。按复杂度真正分层：simple 最短；decide 只在 hard 出现且位于
// plan 之后（先有方案比较，用户再拍板）；fix 为条件阶段，review 无阻塞发现时跳过。
const MODE_STAGES: Record<string, string[]> = {
  "feature-simple": [
    STAGE.implement,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  "feature-medium": [
    STAGE.plan,
    STAGE.implement,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  "feature-hard": [
    STAGE.plan,
    STAGE.decide,
    STAGE.implement,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  bugfix: [
    STAGE.investigate,
    STAGE.implement,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
  refactor: [
    STAGE.investigate,
    STAGE.plan,
    STAGE.implement,
    STAGE.review,
    STAGE.fix,
    STAGE["final-verify"],
    STAGE.close,
  ],
};

// 模板占位哨兵：所有模板用 HTML 注释 <!-- XFT-TODO: ... --> 标记待填位置。
// 正文不可能合理出现、渲染不可见，误伤与绕过都比日常词（如"待补充"）少得多。
const PLACEHOLDER_MARKERS = ["<!-- XFT-TODO"];

// feature-hard 必须有结构化执行记录的阶段：证据键 = 阶段 + 执行者（worker / worker-ro / main），
// 不再耦合具体 agent 名——同一个通用 worker 在不同阶段装载不同方法论 skill。
// 指挥/编排职责由 pilot 主会话承担（subagent 无法再分派 subagent），不设 conductor。
const REQUIRED_HARD_STAGES = [STAGE.plan, STAGE.implement, STAGE.review];

// 合法执行者：worker（读写，implement/fix）、worker-ro（只读 + Bash，探索/调查/设计/审查/验证）、
// main（主会话兜底，仅限无 subagent 的运行时或分派失败，自录必须带 reason，不得静默顶替）。
const EXECUTORS = ["worker", "worker-ro", "main"];

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
  ["feature-simple", "新增或改变功能，但需求清楚、单点改动、低风险（复杂度 0-2 分且未命中任何 hard_floors）。"],
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

// 评分之外的硬底线：评分定档后逐条核对，命中即取「评分档」与「底线档」的较高者。
// 评分是加和制，没有底线时"骨架项目/无生产数据"之类的理由会把认证系统折算成
// feature-simple，把多模块 API 折算掉 plan 阶段——这是路由层最该挡住的降档。
const ROUTING_HARD_FLOORS: [string, string][] = [
  [
    "security-hard",
    "任务要求新建或重构认证/授权体系，或要求为安全敏感能力设计分层/跨层结构（如路由/服务/中间件/存储）：直接 feature-hard。",
  ],
  [
    "security-medium",
    "任务涉及认证、授权、会话/令牌、密码或凭据存储、权限控制、支付计费或加密：risk 与 decision 维度强制各计 1 分（不得以演示/骨架/无生产数据为由计 0），且最低 feature-medium。",
  ],
  [
    "multi-module-medium",
    "新增功能涉及 2 个以上新模块，或用户明确要求拆分模块/分层：最低 feature-medium。",
  ],
  [
    "ui-e2e-medium",
    "命中 ui 维度（UI 流程、状态管理、可访问性或浏览器 E2E）：最低 feature-medium，且 init 必须加 --ui true。",
  ],
];

interface StagePolicy {
  stage: string;
  purpose: string;
  // 本阶段的执行者变体：worker（读写）或 worker-ro（只读）；main 阶段（decide/close）留空字符串。
  // 阶段的专业方法论不在 agent 身上，而在 STAGE_METHODOLOGY_SKILLS 指名的 skill 里。
  executor: string;
  required_skills: string[];
  conditional_skills: string[];
  input_contract: string[];
  output_contract: string[];
  quality_gate: string[];
}

const STAGE_POLICIES: Record<string, StagePolicy> = {
  [STAGE.investigate]: {
    stage: STAGE.investigate,
    purpose: "建立 bug 复现、根因证据，或重构行为基线。",
    executor: "worker-ro",
    required_skills: [],
    conditional_skills: ["当 UI 复现或行为基线需要浏览器时使用 agent-browser"],
    input_contract: ["01-requirements.md。", "相关代码、日志、测试或用户复现信息。"],
    output_contract: ["复现/基线状态。", "证据链。", "最小修复或重构保护范围。"],
    quality_gate: ["证据不足时只写假设，不得断言根因。", "UI 问题需要真实浏览器证据或显式说明环境不足。"],
  },
  [STAGE.plan]: {
    stage: STAGE.plan,
    purpose: "沉淀设计、修复策略、重构方案、测试策略和任务拆分。",
    executor: "worker-ro",
    required_skills: [],
    conditional_skills: [
      "当任务改变前端视觉设计、交互或可用性时使用 frontend-design",
      "当需要 UI/E2E 验收时使用 agent-browser",
    ],
    input_contract: [
      "01-requirements.md。",
      "00-routing.md。",
      "investigate 输出（如存在）。",
      "inputs.available_skills（next 已内联本机可用 skill，无需再扫描）。",
    ],
    output_contract: [
      "设计/修复/重构方案。",
      "测试策略。",
      "任务拆分（add-task 登记，owner 默认 worker，不得是主会话）：每个实现任务 = 一个测试点 + 最小实现，" +
        "标题写明涉及文件；任务间文件范围不相交是硬约束，重叠或共享同一测试入口的任务用 --deps 串联（多个用逗号分隔）。",
      "无依赖且文件范围不相交的任务会被并发分派给多个 worker——时长只是参考（通常几分钟），" +
        "一个内聚单元拆碎后仍要共享上下文时，宁可保留为一个稍大的任务，不要为凑粒度切碎。",
      "feature-hard：写入 02-design.md 的待用户拍板决策点清单（留待 decide 阶段）。",
      "建议的 required/optional skill 清单（optional 项由主会话向用户确认）。",
    ],
    quality_gate: [
      "required skill 必须先 skills check。",
      "实现类任务 owner 不得是主会话。",
      "实现任务必须满足「一个测试点 + 最小实现、文件范围互不相交」的拆分纪律；确实拆不动的大任务要在设计文档写明原因与风险。",
      "feature-hard 不得把方案写成已定稿——用户抉择由主会话在 decide 阶段经 record-decision 写回。",
    ],
  },
  [STAGE.decide]: {
    stage: STAGE.decide,
    purpose: "主会话就 02-design.md 列出的关键取舍逐个向用户拿到拍板结论。",
    executor: "main",
    required_skills: [],
    conditional_skills: [],
    input_contract: ["02-design.md 的待决策点清单。", "01-requirements.md。"],
    output_contract: [
      "用户选择与被拒方案。",
      "该选择对设计、测试和验收的影响。",
      "经 record-decision 写入设计文档开头的抉择记录。",
    ],
    quality_gate: [
      "优先使用 AskUserQuestion 等运行时提问工具，每次只问一个关键决策并附推荐答案。",
      "不得替用户静默拍板高风险产品或架构取舍。",
      "拍板结论必须用 record-decision 落库后才能 advance。",
    ],
  },
  [STAGE.implement]: {
    stage: STAGE.implement,
    purpose: "测试先行或补齐保护后完成最小实现，并运行基础验证到可审查状态。",
    executor: "worker",
    required_skills: [],
    conditional_skills: [],
    input_contract: [
      "确认需求。",
      "设计/计划。",
      "任务列表；并发分派时还包括你领到的专属任务 ID 与文件范围（只做这一个任务）。",
      "当前测试用例文档（无则先用 new-test-round --if-missing true 创建/复用第 1 轮；用例用 add-test-case 登记进测试矩阵，再用 check-test 更新状态）。",
    ],
    output_contract: [
      "失败测试或回归测试证据。",
      "最小实现说明。",
      "基础验证命令、结果与是否达到可审查状态。",
    ],
    quality_gate: [
      "先测试后实现。",
      "主会话不得直接编辑业务代码、测试或配置。",
      "并发实现时只改动自己任务声明的文件范围，submit 必须加 --append true 追加自己的小节；发现任务实际远超「一个测试点 + 最小实现」时先上报拆分建议，不得自行扩范围。",
      "实现结束必须运行基础冒烟验证并记录结果（并发时只跑与本任务最相关的最小测试命令，避免互相干扰）；它不替代 review，也不替代 final-verify。",
      "失败必须解释原因和下一步。",
    ],
  },
  [STAGE.review]: {
    stage: STAGE.review,
    purpose: "在最终验证前完成代码审查。",
    executor: "worker-ro",
    required_skills: [],
    conditional_skills: ["当本机已安装通用 code-review skill 且对任务有帮助时使用"],
    input_contract: ["本次变更 diff。", "需求、设计和测试结果。"],
    output_contract: [
      "按严重度排序的审查发现。",
      "测试缺口。",
      "必须补回归测试的问题。",
      "修复后复跑路径。",
      "record-review --blocking true|false 登记的审查结论（true 必须带 --summary）。",
    ],
    quality_gate: [
      "审查必须早于 final-verify。",
      "审查结论必须用 record-review 落库：有阻塞发现 --blocking true，无则 false（fix 阶段据此跳过）。",
      "审查发现必须回交 fix 阶段的实现 worker 闭环。",
      "审查必须由独立分派的 worker-ro 完成，不得用主会话自检替代。",
    ],
  },
  [STAGE.fix]: {
    stage: STAGE.fix,
    purpose: "闭环审查发现，补回归测试并复跑受影响验证（review 无阻塞发现时自动跳过）。",
    executor: "worker",
    required_skills: [],
    conditional_skills: [],
    input_contract: ["record-review 登记的审查结论与阻塞摘要。", "必须补回归测试列表。"],
    output_contract: ["新增/修改回归测试。", "修复说明。", "受影响验证结果。"],
    quality_gate: ["先补回归测试再修复。", "修复由实现 worker 执行，不回流主会话。"],
  },
  [STAGE["final-verify"]]: {
    stage: STAGE["final-verify"],
    purpose: "审查修复后执行最终自动化验证、E2E 回归或等价验证。",
    executor: "worker-ro",
    required_skills: [],
    conditional_skills: ["当涉及 UI/E2E 时使用 agent-browser"],
    input_contract: ["最新测试用例文档。", "审查和修复闭环结果。"],
    output_contract: ["最终验证命令或真实浏览器路径。", "通过/失败证据。", "check-test 更新建议。"],
    quality_gate: ["必须发生在 review/fix 之后。", "UI/E2E 必须经 agent-browser 取得真实浏览器证据，或显式记录降级/阻塞。"],
  },
  [STAGE.close]: {
    stage: STAGE.close,
    purpose: "运行 validate/close，完成交付汇报。",
    executor: "main",
    required_skills: [],
    conditional_skills: [],
    input_contract: ["status 或 validate 输出。", "所有阶段证据。"],
    output_contract: ["close 成功结果。", "最终交付摘要。", "残余风险。"],
    quality_gate: ["close 失败不得强行汇报完成。", "required skill/agent 必须有证据或显式降级/阻塞记录。"],
  },
};

// 各阶段对应的方法论 skill（本插件 skills/ 下的 SKILL.md）。这是阶段专业能力的唯一归属：
// worker 没有 Skill 工具，按 next 输出里的绝对路径 Read 这些 SKILL.md 作为本阶段方法论；
// 一个阶段可挂多个 skill，是否适用由各 SKILL.md 自身的适用条件说明（如 domain-modeling
// 仅在业务规则复杂时使用）。workflow-router / grill-idea 由主会话（pilot）在 init 之前直接
// 调用；explore-project 由 pilot 在 init 之前分派给 worker-ro。
const STAGE_METHODOLOGY_SKILLS: Record<string, string[]> = {
  [STAGE.investigate]: ["investigation"],
  [STAGE.plan]: ["solution-design", "task-splitting", "domain-modeling"],
  [STAGE.implement]: ["tdd"],
  [STAGE.fix]: ["tdd"],
  [STAGE.review]: ["code-review"],
  [STAGE["final-verify"]]: ["e2e-verification"],
};

// decide/close 由主会话（pilot）直接驱动：decide 用 AskUserQuestion 拿用户拍板并
// record-decision 落库；close 运行 validate/close 收尾。其余阶段由 next 指名的 worker 变体执行。
const MAIN_DRIVEN_STAGES = new Set<string>([STAGE.decide, STAGE.close]);

// skills list 不硬编码任何 skill，而是扫描本机标准 skill 安装目录，
// 解析每个 SKILL.md 的 frontmatter，返回真实可用的 skill 目录。
// 是否启用、必备还是可选，由模型读取目录后结合任务语义自行判断。
// 扫描来源（按优先级，靠前者覆盖靠后者的同名 skill）：
//   1. 当前插件自带 skills
//   2. Codex 项目级 ./.agents/skills
//   3. Codex 用户级 ~/.agents/skills
//   4. Claude 项目级 ./.claude/skills
//   5. Claude 用户级 ~/.claude/skills
//   6. Claude 已安装且【在当前会话启用】的插件提供的 skill
//      （依据 installed_plugins.json + settings 的 enabledPlugins；装在磁盘但未启用的不计入）
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

// Claude Code 用 settings 的 enabledPlugins 决定插件是否在【当前会话】真正启用、
// 其 skill 是否能经 Skill 工具调用。installed_plugins.json 只表示“装在磁盘上”，
// 与“会话内可用”是两回事——装了但未启用时，Skill 调用会返回 Unknown skill。
// 按 user < project < project-local 的优先级合并（后者覆盖前者同名 key）。
const SETTINGS_FILES: string[] = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(process.cwd(), ".claude", "settings.json"),
  path.join(process.cwd(), ".claude", "settings.local.json"),
];

function readJsonFile(p: string): any {
  if (!isFile(p)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

// 返回各插件 key 的有效启用状态（true 表示当前会话已启用，可调用其 skill）。
function enabledPluginState(): Map<string, boolean> {
  const merged = new Map<string, boolean>();
  for (const file of SETTINGS_FILES) {
    const data = readJsonFile(file);
    const ep = data && data.enabledPlugins;
    if (ep && typeof ep === "object") {
      for (const [key, val] of Object.entries(ep)) {
        merged.set(key, val === true);
      }
    }
  }
  return merged;
}

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

// 阶段执行记录：证据键 = 阶段 + 执行者（worker / worker-ro / main），每个阶段一条。
// participated 必须带 evidence；skipped 必须带 reason；executor 为 main 时必须带 reason
// （无 subagent 的运行时或 worker 分派失败的兜底必须显式留痕，不得静默顶替）。
interface ExecutionRecord {
  stage: string;
  executor: string;
  decision: string;
  evidence?: string;
  reason?: string;
}

// review 阶段经 record-review 落库的审查结论；fix 阶段据此决定是否跳过。
interface ReviewVerdict {
  blocking: boolean;
  summary?: string;
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
  executions: ExecutionRecord[];
  // 任务是否涉及 UI 流程 / 浏览器 E2E。命中路由的 ui 复杂度维度时由 init --ui true 持久化，
  // close 门禁据此强制 E2E（final-verify 执行记录 + agent-browser）与 frontend-design 决策不被静默降级。
  ui?: boolean;
  // review 阶段的审查结论（record-review 写入）；blocking=false 时 fix 阶段可跳过。
  review?: ReviewVerdict;
  // 运行时标识（claude/codex）。codex 无 subagent 机制，阶段可由主会话以
  // --executor main + reason 自录通过门禁；worker 隔离执行的保证只在支持 subagent 的运行时成立。
  runtime?: string;
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
  if (doc.endsWith("review.md")) return "review.md";
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

// ---- 任务目录写锁：支撑 implement/fix 阶段多 agent 并发自录 ----
// 所有可变子命令在 main 入口处持锁执行（mkdir 原子性 + 过期窃取），
// 避免并发 agent 同时读改写 workflow.json / 文档时丢更新。

const LOCK_WAIT_MS = 15_000;
const LOCK_STALE_MS = 60_000;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withTaskLock<T>(taskDir: string, fn: () => T): T {
  const lockDir = path.join(taskDir, ".lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (Date.now() > deadline) {
        fail(`获取写锁超时：${lockDir}（其他 agent 正在写入；确认无并发进程后可删除该目录重试）`);
      }
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // 锁刚被释放，立即重试（超时已在上方守住）
      }
      sleepMs(50 + Math.floor(Math.random() * 100));
    }
  }
  // fail() 走 process.exit，不会执行 finally——用 exit 钩子兜底释放，避免锁泄漏。
  let locked = true;
  const release = (): void => {
    if (locked) {
      locked = false;
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // 释放失败只能留给 LOCK_STALE_MS 过期窃取。
      }
    }
  };
  process.once("exit", release);
  try {
    return fn();
  } finally {
    release();
  }
}

function cmdRoute(flags: Flags): void {
  // 代码不替模型做路由决策，只回显澄清后的任务并提供评判框架。
  // 模型应先完成公共的 receive/explore-and-clarify，再读取本输出判断 mode。
  // 输出只含路由决策所需的框架（任务类型、复杂度维度、评分档），
  // 不再携带 stage_policies / atomic_stages 等与路由无关的大块内容。
  const payload = {
    task: reqStr(flags, "task"),
    instructions:
      "仅在完成最小必要需求澄清后调用本命令。代码不对任务做关键词匹配或自动定级。请你阅读澄清后的 task，" +
      "先在 task_types 中判断任务类型，再用 complexity_dimensions 逐项自评" +
      "（每命中一项计 1 分），按 scoring_bands 得到 feature 的复杂度，" +
      "然后逐条核对 hard_floors：任一命中时取评分档与底线档的较高者作为最终 mode，" +
      "并把每条底线的命中/排除结论写入 00-routing.md。" +
      "最后用判断出的 mode 调用 init。bugfix 与 refactor 优先于复杂度评分。" +
      "若复杂度自评命中 ui 维度（涉及 UI 流程、状态管理、可访问性或浏览器 E2E），" +
      "调用 init 时必须加 --ui true：收尾门禁据此强制 E2E（final-verify 真实执行记录 + agent-browser）" +
      "与 frontend-design 决策不被静默降级；UI 涉及面在 investigate/plan 才浮现时用 set-ui --value true 补开。",
    task_types: TASK_TYPES.map(([name, desc]) => ({ type: name, definition: desc })),
    complexity_dimensions: COMPLEXITY_DIMENSIONS.map(([name, desc]) => ({
      dimension: name,
      criterion: desc,
    })),
    scoring_bands: SCORING_BANDS.map(([mode, desc]) => ({ mode, band: desc })),
    hard_floors: ROUTING_HARD_FLOORS.map(([name, rule]) => ({ rule: name, requirement: rule })),
  };
  console.log(JSON.stringify(payload, null, 2));
}

function cmdStagePolicy(flags: Flags): void {
  const stage = reqChoice(flags, "stage", Object.keys(STAGE_POLICIES));
  const mode = flags.mode === undefined ? "" : String(flags.mode);
  if (mode && !(mode in MODE_STAGES)) {
    fail(`未知工作流模式：${mode}`);
  }
  if (mode) {
    const stages = MODE_STAGES[mode];
    if (!stages.includes(stage)) {
      fail(`阶段 ${stage} 不属于工作流模式 ${mode}`);
    }
  }
  const policy = STAGE_POLICIES[stage];
  const payload = {
    stage,
    mode: mode || null,
    instructions:
      "按本阶段 policy 准备输入、生成输出并检查 quality_gate。pilot 命令只负责推动流程；" +
      "阶段专业工作交给 policy.executor 指名的 worker 变体，方法论来自阶段挂载的 skill，" +
      "required/conditional skill 落定后用 skills check 与 record-skill 留证据。",
    policy,
  };
  console.log(JSON.stringify(payload, null, 2));
}

// next：返回当前可执行阶段的“分派包”，让 pilot 无需枚举阶段即可推进。
// 只读——不改状态。pilot 据此分派 agent（或对 main 阶段直接处理），完成后
// 用 advance --stage <advance_to> 推进，再次调用 next，直到 done。
function cmdNext(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const meta = loadMeta(taskDir);
  const stageNames = meta.stages.map((s) => s.name);
  const idx = stageNames.indexOf(meta.current_stage);
  if (idx === -1) {
    fail(`当前阶段不属于工作流：${meta.current_stage}`);
  }
  const current = meta.stages[idx];

  // close 已执行（其状态为 completed）即视为整个工作流收尾完成。
  if (meta.current_stage === STAGE.close && current.status === "completed") {
    console.log(
      JSON.stringify(
        { done: true, mode: meta.mode, stage: STAGE.close, message: "工作流已 close，流程结束。" },
        null,
        2,
      ),
    );
    return;
  }

  const stage = meta.current_stage;
  const policy = STAGE_POLICIES[stage];
  const advanceTo = idx + 1 < stageNames.length ? stageNames[idx + 1] : null;
  const isMain = MAIN_DRIVEN_STAGES.has(stage);

  // fix 是条件阶段：review 已登记无阻塞发现时建议直接跳过（advance 会标记 skipped）。
  if (stage === STAGE.fix && meta.review && meta.review.blocking === false) {
    console.log(
      JSON.stringify(
        {
          done: false,
          mode: meta.mode,
          stage,
          skip_recommended: true,
          reason: "review 已用 record-review 登记为无阻塞发现，fix 阶段无需分派。",
          advance_to: advanceTo,
        },
        null,
        2,
      ),
    );
    return;
  }

  const skillNames = STAGE_METHODOLOGY_SKILLS[stage] ?? [];
  const skillPaths: Record<string, string> = {};
  for (const name of skillNames) {
    skillPaths[name] = path.join(PLUGIN_ROOT, "skills", name, "SKILL.md");
  }

  // 轻量上下文的程序保证：只下发本阶段输入契约对应的文档，不再全量列出任务目录。
  const docs = stageInputDocs(taskDir, meta, stage).map((p) => ({ doc: path.basename(p), path: p }));

  const primaryDocs = stagePrimaryDocs(taskDir, meta, stage);
  const primaryDoc =
    primaryDocs.length > 0 ? primaryDocs[primaryDocs.length - 1] : "<本阶段对应文档>";
  const extraDocs = primaryDocs.slice(0, -1);

  const recordInstructions = isMain
    ? stage === STAGE.decide
      ? "本阶段由主会话直接处理：读取设计文档的待决策点，优先用 AskUserQuestion 逐个向用户拿到拍板结论" +
        "（每次一个决策，附推荐答案），然后用 record-decision --stdin 把抉择写入设计文档开头，再 advance。"
      : "本阶段由主会话直接处理（运行 validate/close 收尾），不分派 worker。"
    : "本阶段产出必须由你（被分派的 worker）自行写回 .xft-comat，主会话不替你写：" +
      `优先用 \`node ${SCRIPT_PATH} submit --task-dir ${taskDir} --stage ${stage} --executor ${policy.executor} --doc ${primaryDoc} --stdin\` 一次完成写文档与登记本阶段执行` +
      (extraDocs.length > 0 ? `（本阶段另需先用 \`set-doc\` 写 ${extraDocs.join("、")}）` : "") +
      "；--doc 只接受任务目录中已存在的注册文档（由 init/new-test-round 创建），不要自创文档名；" +
      "submit/set-doc 默认整篇覆盖目标文档，先读原文再合并改写；" +
      "测试用例三步走：首轮先 `new-test-round --if-missing true` 创建/复用本轮文档 → 用 " +
      "`add-test-case --round <n> --case <TC 编号> --desc \"类型：... — 目标：...\"` 把用例逐条登记进「测试矩阵」" +
      "（并发安全；TC 编号全局唯一，并发批次中建议带任务序号前缀避免撞号；" +
      "只有整篇改写测试轮文档的叙述章节才用 set-doc）→ 跑完测试用 " +
      "`check-test --round <n> --case <TC 编号> --status passed|failed` " +
      "逐条更新状态（未登记的用例会被拒绝，不会静默新增）；" +
      ([STAGE.implement, STAGE.fix].includes(stage)
        ? "多 worker 并发实现时 submit 必须加 `--append true`，把你的产出作为新小节（标题含你的任务 ID）追加，不得整篇覆盖他人记录；" +
          `实现/修复完成后，用 \`set-task --task-dir ${taskDir} --id <任务ID> --status done --evidence "<验证证据>"\` 标记对应实现任务；`
        : "") +
      (stage === STAGE.review
        ? `审查结论必须用 \`record-review --task-dir ${taskDir} --blocking true|false [--summary "<阻塞摘要>"]\` 落库；`
        : "") +
      (stage === STAGE["final-verify"]
        ? `若本阶段产出全部经 check-test 落库而未走 submit，必须另用 \`record-stage --task-dir ${taskDir} --stage ${stage} --executor ${policy.executor} --decision participated --evidence "<真实验证证据>"\` 留下执行记录；`
        : "") +
      "required/conditional skill 用 `record-skill` 留证据。" +
      "advance/close 只归主会话——你完成自录后直接汇报结果，不要推进状态机。";

  const inputs: Record<string, unknown> = {
    summary: meta.summary,
    contract: policy.input_contract,
    docs,
  };
  if (stage === STAGE.plan) {
    // skill 介入决策内联到 plan 输入：设计 agent 直接基于真实可用 skill 给建议，
    // optional 项由主会话在 implement 前向用户确认，不再单独分派侦察 agent。
    inputs.available_skills = discoverSkills();
  }
  if (stage === STAGE.fix && meta.review) {
    inputs.review = meta.review;
  }

  // implement/fix：下发未完成的实现任务清单，待办 ≥ 2 时要求 pilot 按依赖分波、
  // 同一波内每任务并发分派一个独立 worker（拆小任务并发执行，替代单 worker 长跑）。
  let pendingTasks: { id: string; title: string; owner: string; status: string; deps: string | null }[] = [];
  if ([STAGE.implement, STAGE.fix].includes(stage)) {
    pendingTasks = (meta.tasks ?? [])
      .filter((t) => (t.kind ?? "implementation") === "implementation" && t.status !== "done")
      .map((t) => ({ id: t.id, title: t.title, owner: t.owner, status: t.status, deps: t.deps ?? null }));
    if (pendingTasks.length > 0) {
      inputs.pending_tasks = pendingTasks;
    }
  }
  const parallel = !isMain && pendingTasks.length >= 2;

  const payload = {
    done: false,
    mode: meta.mode,
    stage,
    purpose: policy.purpose,
    dispatch: {
      kind: isMain ? "main" : "agent",
      agent: policy.executor,
      apply_skills: skillNames,
      skill_paths: skillPaths,
      required_skills: policy.required_skills,
      conditional_skills: policy.conditional_skills,
      parallel,
      ...(parallel
        ? {
            parallel_instructions:
              "不要把整个阶段打包给一个 worker。按 inputs.pending_tasks 分波并发：" +
              "(1) 取所有依赖均已 done（或无依赖）的任务作为一波；文件范围重叠或共享同一测试入口的任务顺延到下一波。" +
              "(2) 同一波内每个任务分派一个独立的 worker——在同一条回复中并行发出多个 Task 调用，每个 worker 只领一个任务 ID。" +
              "(3) 每个分派提示必须写明：script_path 与 task_dir（worker 自己跑 next 取本阶段完整分派包）、" +
              "该 worker 专属的任务 ID/标题/文件范围、只动该范围、submit 加 --append true 追加小节、" +
              "完成后 set-task --id <任务ID> --status done --evidence 标记。" +
              "(4) 首轮测试文档统一用 new-test-round --if-missing true 创建/复用，用例用 add-test-case 登记。" +
              "(5) 一波全部 set-task done 后再发下一波；所有实现任务 done 后才 advance。",
          }
        : {}),
    },
    inputs,
    outputs_expected: policy.output_contract,
    quality_gate: policy.quality_gate,
    record_instructions: recordInstructions,
    advance_to: advanceTo,
    script_path: SCRIPT_PATH,
    task_dir: taskDir,
  };
  console.log(JSON.stringify(payload, null, 2));
}

// 各阶段 submit 的主文档（按 mode 落到具体文件名）。submit 只接受当前阶段
// 允许的主文档，避免后续阶段误覆盖设计、复现或重构计划等上游证据。
// 末位是 submit 主文档；之前的条目（如 bugfix 的复现记录）用 set-doc 先行写入。
// review/fix 的发现与闭环写回专用 review 文档（审查结论另以 record-review 落库）；
// final-verify 的主文档是最新测试轮文档，运行时计算。
const IMPLEMENT_PRIMARY_DOCS: Record<string, string[]> = {
  "feature-simple": ["02-design-note.md"],
  "feature-medium": ["02-design.md"],
  "feature-hard": ["02-design.md"],
  bugfix: ["03-root-cause.md"],
  refactor: ["02-refactor-plan.md"],
};

const REVIEW_PRIMARY_DOCS: Record<string, string[]> = {
  "feature-simple": ["07-review.md"],
  "feature-medium": ["07-review.md"],
  "feature-hard": ["07-review.md"],
  bugfix: ["08-review.md"],
  refactor: ["08-review.md"],
};

const STAGE_PRIMARY_DOCS: Record<string, Record<string, string[]>> = {
  [STAGE.investigate]: {
    bugfix: ["02-reproduction.md", "03-root-cause.md"],
    refactor: ["03-safety-net.md"],
  },
  [STAGE.plan]: {
    "feature-medium": ["02-design.md"],
    "feature-hard": ["02-design.md"],
    refactor: ["02-refactor-plan.md"],
  },
  [STAGE.implement]: IMPLEMENT_PRIMARY_DOCS,
  [STAGE.review]: REVIEW_PRIMARY_DOCS,
  [STAGE.fix]: REVIEW_PRIMARY_DOCS,
};

function stagePrimaryDocs(taskDir: string, meta: Meta, stage: string): string[] {
  if (stage === STAGE["final-verify"]) {
    const latest = latestTestRoundPath(taskDir, meta);
    return latest ? [path.basename(latest)] : [];
  }
  const names = STAGE_PRIMARY_DOCS[stage]?.[meta.mode] ?? [];
  return names.filter((name) => existsSync(path.join(taskDir, name)));
}

function stageSubmitDocs(taskDir: string, meta: Meta, stage: string): string[] {
  const docs = stagePrimaryDocs(taskDir, meta, stage);
  return docs.length === 0 ? [] : [docs[docs.length - 1]];
}

// 各阶段输入文档白名单：轻量上下文的程序保证，而非靠 agent 自觉少读。
// implement/review/fix/final-verify 额外追加最新一轮测试用例文档。
const STAGE_INPUT_DOC_PATTERNS: Record<string, RegExp[]> = {
  [STAGE.investigate]: [/^00-routing\.md$/, /^01-requirements\.md$/],
  [STAGE.plan]: [/^00-routing\.md$/, /^01-requirements\.md$/, /reproduction|root-cause|safety-net/],
  [STAGE.decide]: [/^01-requirements\.md$/, /design/],
  [STAGE.implement]: [/^01-requirements\.md$/, /design|root-cause|refactor-plan|safety-net/, /tasks\.md$/],
  [STAGE.review]: [/^01-requirements\.md$/, /design|root-cause|refactor-plan/],
  [STAGE.fix]: [/^01-requirements\.md$/],
  [STAGE["final-verify"]]: [/^01-requirements\.md$/],
  [STAGE.close]: [/./],
};

const TEST_ROUND_INPUT_STAGES = new Set<string>([
  STAGE.implement,
  STAGE.review,
  STAGE.fix,
  STAGE["final-verify"],
]);

function stageInputDocs(taskDir: string, meta: Meta, stage: string): string[] {
  const patterns = STAGE_INPUT_DOC_PATTERNS[stage] ?? [/./];
  const picked = workflowDocs(taskDir).filter((p) =>
    patterns.some((re) => re.test(path.basename(p))),
  );
  if (TEST_ROUND_INPUT_STAGES.has(stage)) {
    const latest = latestTestRoundPath(taskDir, meta);
    if (latest && !picked.includes(latest)) {
      picked.push(latest);
    }
  }
  return picked;
}

function cmdInit(flags: Flags): void {
  const mode = reqStr(flags, "mode");
  if (!(mode in MODE_DOCS)) {
    fail(`未知工作流模式：${mode}`);
  }
  const topic = slugify(reqStr(flags, "topic"));
  const summary = reqStr(flags, "summary");
  const ui = optBool(flags, "ui");
  const runtime =
    flags.runtime === undefined ? "" : reqChoice(flags, "runtime", ["claude", "codex"]);
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
    executions: [],
    ui,
  };
  if (runtime) {
    meta.runtime = runtime;
  }
  meta.stages[0].status = "in_progress";
  saveMeta(taskDir, meta);
  // 任务列表初始即为程序渲染的有效空态（"暂无任务"），不留模板占位：
  // 简单任务不被迫为填表而填表，hard 仍由 validate 强制 add-task。
  rewriteTasks(taskDir, meta);
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
    let marker = " ";
    if (item.status === "completed") {
      marker = "x";
    } else if (item.status === "in_progress") {
      marker = ">";
    } else if (item.status === "skipped") {
      marker = "~";
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
  // 唯一例外：fix 是条件阶段，review 已用 record-review 登记无阻塞发现时允许跳过。
  // 回退到更早阶段重做不受守卫限制。
  const fixSkippable = meta.review !== undefined && meta.review.blocking === false;
  if (targetIndex > currentIndex) {
    for (let i = 0; i < targetIndex; i++) {
      const item = meta.stages[i];
      if (item.status !== "pending") {
        continue;
      }
      if (item.name === STAGE.fix && fixSkippable) {
        continue;
      }
      fail(
        `无法推进到 ${stage}：实质阶段 ${item.name} 仍未完成（pending），不能跳过。` +
          `请先 advance --stage ${item.name} 逐阶段推进。`,
      );
    }
  }
  // 目标之前标 completed（条件跳过的 fix 标 skipped），目标标 in_progress，
  // 目标之后重置为 pending。回退重做时借此清除后续阶段过期的完成状态。
  for (const [index, item] of meta.stages.entries()) {
    if (index < targetIndex) {
      // fix 可跳过时，pending（直接越过）与 in_progress（先进入又被 next 建议跳过）
      // 都标 skipped，保留"审查无阻塞、未实际修复"的审计事实。
      if (item.name === STAGE.fix && fixSkippable && item.status !== "completed") {
        item.status = "skipped";
      } else if (item.status !== "skipped") {
        item.status = "completed";
      }
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

// set-doc/submit 猜错文档名是高频失败：报错时直接列出当前注册文档，终止猜名循环。
function knownDocsHint(taskDir: string): string {
  const names = workflowDocs(taskDir).map((p) => path.basename(p));
  return names.length > 0
    ? `当前注册文档：${names.join("、")}（由 init/new-test-round 创建，不要自创文档名）`
    : "任务目录中没有已注册文档";
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

function validateNoPlaceholders(taskDir: string, meta: Meta, errors: string[]): void {
  const latestRound = latestTestRoundPath(taskDir, meta);
  for (const p of workflowDocs(taskDir)) {
    // 历史测试轮已被新一轮替代，作为审计轨迹保留，不再检查占位。
    if (path.basename(p).includes("test-cases-round-") && p !== latestRound) {
      continue;
    }
    const content = readFileSync(p, "utf-8");
    for (const marker of PLACEHOLDER_MARKERS) {
      if (content.includes(marker)) {
        errors.push(`${path.basename(p)} 仍包含模板占位哨兵（${marker} ... -->），交付前必须替换为真实内容`);
      }
    }
  }
}

interface ParsedSkillRecord {
  skill: string;
  decision: string;
  rest: string;
}

// 只结构化解析 record-skill 生成的记录行：- `skill` — 决策 — 原因[ — 证据：…]，
// 按决策字段精确判断，避免把说明文字里出现的 "required" 误判为记录。
const SKILL_RECORD_PATTERN = /^- `([^`]+)` — (\S+) — (.+)$/;

function readSkillRecords(taskDir: string): ParsedSkillRecord[] {
  const skillDoc = findSkillDoc(taskDir);
  if (!skillDoc) {
    return [];
  }
  const content = readFileSync(path.join(taskDir, skillDoc), "utf-8");
  const usageMatch = content.match(/## 使用记录\n([\s\S]*?)(\n## |$)/);
  const usageSection = usageMatch ? usageMatch[1] : content;
  const records: ParsedSkillRecord[] = [];
  for (const raw of usageSection.split("\n")) {
    const match = raw.trim().match(SKILL_RECORD_PATTERN);
    if (match) {
      records.push({ skill: match[1], decision: match[2], rest: match[3] });
    }
  }
  return records;
}

// 仪式最小化：不再做"证据："字符串检查（只能验证一句话存在，验证不了真实性，
// 徒增书写负担）；保留机器可核验的结构化检查——submit / record-stage 写入时已强制
// participated 带 evidence、skipped 带 reason、main 带 reason，此处只核对 hard 的覆盖面。
function validateRequiredParticipation(taskDir: string, meta: Meta, errors: string[]): void {
  if (!findSkillDoc(taskDir)) {
    errors.push("找不到 skill 使用记录文件");
    return;
  }
  if (meta.mode === "feature-hard") {
    // 证据键 = 阶段 + 执行者：从结构化执行记录判断，而非字符串包含（避免"写了名字但未真正执行"蒙混）。
    const byStage = new Map((meta.executions ?? []).map((rec) => [rec.stage, rec]));
    for (const stageName of REQUIRED_HARD_STAGES) {
      const rec = byStage.get(stageName);
      if (!rec) {
        errors.push(
          `feature-hard 必须有 ${stageName} 阶段的结构化执行记录（worker 经 submit 自录，或 record-stage 登记）：缺 ${stageName}`,
        );
      } else if (rec.decision === "participated" && !rec.evidence) {
        errors.push(`${stageName} 阶段记录为 participated 但缺少实质执行证据`);
      } else if (rec.decision === "skipped" && !rec.reason) {
        errors.push(`${stageName} 阶段记录为 skipped 但缺少原因`);
      } else if (rec.executor === "main" && !rec.reason) {
        errors.push(
          `${stageName} 阶段由主会话执行（executor=main）但缺少原因——main 兜底必须显式留痕（如运行时无 subagent 或 worker 分派失败）`,
        );
      }
    }
  }
}

// close 出口与 advance 守卫共享同一套推进事实：所有前置阶段必须 completed 或
// skipped 才能收尾，堵住“init 后填好文档直接 close”绕过阶段守卫的口子。
function validateStageTraversal(meta: Meta, errors: string[]): void {
  for (const item of meta.stages ?? []) {
    if (item.name === STAGE.close) {
      continue;
    }
    if (item.status !== "completed" && item.status !== "skipped") {
      errors.push(
        `阶段 ${item.name} 状态为 ${item.status}，所有实质阶段走完（completed/skipped）前不得 close。`,
      );
    }
  }
}

// review 闭环：review 完成后必须有 record-review 结论；登记了阻塞发现时 fix 不得被跳过。
function validateReviewClosure(meta: Meta, errors: string[]): void {
  const review = (meta.stages ?? []).find((item) => item.name === STAGE.review);
  if (review && review.status === "completed" && !meta.review) {
    errors.push("review 阶段已完成但缺少 record-review 登记的审查结论（--blocking true|false）。");
  }
  const fix = (meta.stages ?? []).find((item) => item.name === STAGE.fix);
  if (meta.review && meta.review.blocking === true && fix && fix.status === "skipped") {
    errors.push("review 登记了阻塞发现（blocking=true），fix 阶段不得为 skipped，必须实际闭环。");
  }
}

// UI 覆盖门禁：任务标记为涉及 UI（meta.ui）时，close 必须看到 E2E 与 frontend-design 的实质决策，
// 堵住“required skill 不可用后由主会话静默用单元测试 / build / 手写 CSS 顶替”的降级。
function validateUiCoverage(taskDir: string, meta: Meta, errors: string[]): void {
  if (!meta.ui) {
    return;
  }
  const skillRecs = readSkillRecords(taskDir);

  // E2E 门：要么 final-verify 阶段有带证据的真实执行记录，要么 agent-browser 被显式记录为降级/阻塞（带原因）。
  const e2e = (meta.executions ?? []).find((rec) => rec.stage === STAGE["final-verify"]);
  const e2eDone = !!(e2e && e2e.decision === "participated" && e2e.evidence);
  const browserDowngraded = skillRecs.some(
    (r) => r.skill === "agent-browser" && (r.decision === "downgraded" || r.decision === "blocked"),
  );
  if (!e2eDone && !browserDowngraded) {
    errors.push(
      "UI 任务必须有 final-verify 阶段的真实执行记录（worker 经 submit 自录，或 " +
        "record-stage --stage final-verify --decision participated 带证据），E2E 须经 agent-browser " +
        "取得真实浏览器证据；agent-browser 不可用时显式记录降级" +
        "（record-skill --skill agent-browser --decision downgraded/blocked --reason …）；" +
        "不得由主会话静默用单元测试或 build 顶替 E2E。",
    );
  }

  // frontend-design 门：必须有显式决策记录（required / skipped / downgraded / blocked 等），不得静默缺席。
  // 不强制一定参与（纯交互流程可记 skipped 带原因），但必须是被记录的、有理由的决定。
  const hasFrontendDesign = skillRecs.some((r) => r.skill === "frontend-design");
  if (!hasFrontendDesign) {
    errors.push(
      "UI 任务必须对 frontend-design 做出显式决策（record-skill --skill frontend-design " +
        "--decision required/skipped/downgraded --reason …）；不得静默省略前端设计能力。",
    );
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
          `实现/测试/前端落地/审查修复必须分派给 worker 执行。`,
      );
    }
  }
}

function validateTaskCompletion(meta: Meta, errors: string[]): void {
  const tasks = meta.tasks ?? [];
  for (const task of tasks) {
    const kind = task.kind ?? "implementation";
    if (kind !== "implementation" || task.status === "done") {
      continue;
    }
    errors.push(
      `${task.id} 是实现类任务但状态仍为 ${task.status}；` +
        `close 前必须由 owner ${task.owner} 用 set-task --status done --evidence "<验证证据>" 标记完成。`,
    );
  }
}

function validateCloseReady(taskDir: string): string[] {
  const meta = loadMeta(taskDir);
  const errors: string[] = [];
  validateReviewOrder(meta, errors);
  validateStageTraversal(meta, errors);
  validateReviewClosure(meta, errors);
  validateNoPlaceholders(taskDir, meta, errors);
  validateRequiredParticipation(taskDir, meta, errors);
  validateUiCoverage(taskDir, meta, errors);
  validateTestClosure(taskDir, meta, errors);
  validateTaskOwnership(meta, errors);
  validateTaskCompletion(meta, errors);
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
  // validateStageTraversal 已保证前置阶段均为 completed/skipped，这里只收尾 close 本身，
  // 保留 skipped 状态作为审计事实。
  for (const item of meta.stages) {
    if (item.status !== "skipped") {
      item.status = "completed";
    }
  }
  meta.current_stage = "close";
  saveMeta(taskDir, meta);
  rewriteState(taskDir, meta);
  console.log(pyJSON({ closed: true, current_stage: "close" }));
}

// 统一的内容入参：--from-file / --content / --stdin 三选一。
function readContentArg(flags: Flags): string {
  const fromFile = flags["from-file"];
  const hasContent = flags.content !== undefined;
  const useStdin = flags.stdin === true;
  const provided = [Boolean(fromFile), hasContent, useStdin].filter(Boolean).length;
  if (provided !== 1) {
    fail("必须且只能提供 --from-file、--content、--stdin 之一");
  }
  if (fromFile) {
    const source = String(fromFile);
    if (!existsSync(source)) {
      fail(`来源文件不存在：${source}`);
    }
    return readFileSync(source, "utf-8");
  }
  if (hasContent) {
    return String(flags.content);
  }
  return readFileSync(0, "utf-8");
}

function cmdSetDoc(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const doc = reqStr(flags, "doc");
  const target = path.join(taskDir, doc);
  if (!existsSync(target)) {
    fail(`目标文档不存在或不属于当前工作流：${target}。${knownDocsHint(taskDir)}`);
  }
  writeFileSync(target, readContentArg(flags), "utf-8");
  console.log(target);
}

// submit = set-doc + 阶段执行记录（participated）合一，一次调用完成本阶段产出落库与执行登记，
// 把 worker 的仪式性调用压到最少。--append true 时把内容作为新小节追加（不整篇覆盖），
// 供 implement/fix 阶段多个并发 worker 各自追加自己任务的实现记录。
function cmdSubmit(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const stage = reqChoice(flags, "stage", Object.keys(STAGE_POLICIES));
  const executor = reqChoice(flags, "executor", EXECUTORS);
  const reason = flags.reason === undefined ? "" : String(flags.reason);
  if (executor === "main" && !reason) {
    fail(
      "submit --executor main 必须提供 --reason（主会话兜底必须显式留痕：运行时无 subagent 或 worker 分派失败）",
    );
  }
  const doc = reqStr(flags, "doc");
  const append = optBool(flags, "append");
  const target = path.join(taskDir, doc);
  if (!existsSync(target)) {
    fail(`目标文档不存在或不属于当前工作流：${target}。${knownDocsHint(taskDir)}`);
  }
  const meta = loadMeta(taskDir);
  const allowedDocs = stageSubmitDocs(taskDir, meta, stage);
  if (!allowedDocs.includes(doc)) {
    const allowed = allowedDocs.length > 0 ? allowedDocs.join("、") : "无可提交文档";
    fail(
      `阶段 ${stage} 不允许 submit 到 ${doc}；允许的 submit 文档：${allowed}。` +
        "如需维护测试矩阵或多文档阶段的前置文档，请使用 set-doc。",
    );
  }
  if (append) {
    const prev = readFileSync(target, "utf-8").replace(/\s+$/, "");
    const body = readContentArg(flags).replace(/^\s+/, "").replace(/\s+$/, "");
    if (!body) {
      fail("submit --append 内容为空");
    }
    writeFileSync(target, `${prev}\n\n${body}\n`, "utf-8");
  } else {
    writeFileSync(target, readContentArg(flags), "utf-8");
  }
  meta.executions = meta.executions ?? [];
  const evidence =
    flags.evidence === undefined ? `${stage} 阶段产出 ${doc}` : String(flags.evidence);
  const record: ExecutionRecord = { stage, executor, decision: "participated", evidence };
  if (reason) {
    record.reason = reason;
  }
  const idx = meta.executions.findIndex((rec) => rec.stage === stage);
  if (idx >= 0) {
    // 并发多任务下同一阶段多次 submit：追加模式合并证据，避免后完成者抹掉先完成者。
    const prevEvidence = meta.executions[idx].evidence;
    if (append && prevEvidence && prevEvidence !== evidence) {
      record.evidence = `${prevEvidence}；${evidence}`;
    }
    meta.executions[idx] = record;
  } else {
    meta.executions.push(record);
  }
  saveMeta(taskDir, meta);
  rewriteExecutionSection(taskDir, meta);
  console.log(pyJSON({ stage, executor, doc, append }));
}

// 主会话在 decide 阶段把用户拍板结论写入设计文档的「用户最终抉择」节（文档前部）。
// 这是路由两文档之外主会话唯一的合法落库点：用户交互产物没有 agent 能代劳。
const DECISION_HEADING = "## 用户最终抉择";

function designDocName(taskDir: string): string {
  for (const name of ["02-design.md", "02-design-note.md"]) {
    if (existsSync(path.join(taskDir, name))) {
      return name;
    }
  }
  return fail("找不到设计文档（02-design.md / 02-design-note.md）");
}

function cmdRecordDecision(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const body = readContentArg(flags).trim();
  if (!body) {
    fail("抉择内容为空");
  }
  const p = path.join(taskDir, designDocName(taskDir));
  let content = readFileSync(p, "utf-8");
  const section = `${DECISION_HEADING}\n\n${body}\n`;
  const headingAt = content.indexOf(DECISION_HEADING);
  if (headingAt === -1) {
    // 模板没有该节时插入到标题行之后（需求：用户抉择添加到设计方案前方）。
    const firstBreak = content.indexOf("\n");
    const head = firstBreak === -1 ? content + "\n" : content.slice(0, firstBreak + 1);
    const tail = firstBreak === -1 ? "" : content.slice(firstBreak + 1);
    content = `${head}\n${section}\n${tail.replace(/^\n+/, "")}`;
  } else {
    const nextHeading = content.indexOf("\n## ", headingAt + DECISION_HEADING.length);
    const sectionEnd = nextHeading === -1 ? content.length : nextHeading + 1;
    content = content.slice(0, headingAt) + section + content.slice(sectionEnd);
  }
  writeFileSync(p, content, "utf-8");
  console.log(p);
}

// review 阶段的审查结论落库：blocking=false 时 fix 阶段自动跳过；
// blocking=true 必须带 --summary，作为 fix 阶段的闭环输入。
function cmdRecordReview(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const blocking = reqChoice(flags, "blocking", ["true", "false"]) === "true";
  const summary = flags.summary === undefined ? "" : String(flags.summary);
  if (blocking && !summary) {
    fail("record-review --blocking true 必须提供 --summary（阻塞发现摘要，供 fix 阶段闭环）");
  }
  const meta = loadMeta(taskDir);
  meta.review = summary ? { blocking, summary } : { blocking };
  saveMeta(taskDir, meta);
  console.log(pyJSON({ blocking, summary: summary || null }));
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

// 从 installed_plugins.json 读取已安装插件的 skills 目录，按 enabledPlugins 拆分为：
//   enabled  —— 当前会话已启用、其 skill 可经 Skill 工具调用，计入可用列表；
//   disabled —— 装在磁盘但未启用，调用会 Unknown skill，仅作诊断，不计入可用列表。
// 只纳入清单中列出的已安装插件，不扫描 marketplace 里未安装的插件。
function pluginSkillRoots(): { enabled: [string, string][]; disabled: [string, string][] } {
  const empty = { enabled: [] as [string, string][], disabled: [] as [string, string][] };
  if (!isFile(INSTALLED_PLUGINS_FILE)) {
    return empty;
  }
  let data: any;
  try {
    data = JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, "utf-8"));
  } catch {
    return empty;
  }
  const enabledMap = enabledPluginState();
  const enabled: [string, string][] = [];
  const disabled: [string, string][] = [];
  const seen = new Set<string>();
  const plugins = (data && data.plugins) || {};
  for (const [pluginKey, records] of Object.entries(plugins)) {
    const isEnabled = enabledMap.get(pluginKey) === true;
    for (const record of (records as any[]) || []) {
      const installPath = record && record.installPath;
      if (!installPath || seen.has(installPath)) {
        continue;
      }
      seen.add(installPath);
      const skillsDir = path.join(installPath, "skills");
      if (isDir(skillsDir)) {
        (isEnabled ? enabled : disabled).push([skillsDir, `plugin:${pluginKey}`]);
      }
    }
  }
  return { enabled, disabled };
}

// 扫描给定 skill 目录，解析 frontmatter，返回去重后的 skill 列表（先扫到的同名优先保留）。
function scanSkillRoots(roots: [string, string][]): SkillRecord[] {
  const found = new Map<string, SkillRecord>();
  for (const [root, scope] of roots) {
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

// 扫描标准 skill 目录与【已启用】插件，返回当前会话真实可调用的 skill 列表。
// 优先级：项目级 > 用户级 > 插件；先扫到的同名 skill 保留。
function discoverSkills(): SkillRecord[] {
  return scanSkillRoots([...SKILL_SEARCH_ROOTS, ...pluginSkillRoots().enabled]);
}

// 已安装但未启用插件提供的 skill：可见于磁盘却无法经 Skill 工具调用，需先启用。
function discoverDisabledSkills(): SkillRecord[] {
  return scanSkillRoots(pluginSkillRoots().disabled);
}

function cmdSkillsList(): void {
  const skills = discoverSkills();
  const disabled = discoverDisabledSkills();
  const payload: Record<string, unknown> = {
    instructions:
      "以下 available_skills 是当前会话【真正可调用】的 skill（扫描当前插件 skills、" +
      "Codex 项目级 .agents/skills、Codex 用户级 ~/.agents/skills、Claude 项目级 .claude/skills、" +
      "用户级 ~/.claude/skills，以及 installed_plugins.json 中【且已在 enabledPlugins 启用】的插件 " +
      "skills，解析每个 SKILL.md frontmatter 得到；scope 字段标明来源，plugin:<key> 表示插件）。" +
      "装在磁盘但未启用的插件不计入 available_skills（调用会 Unknown skill）。" +
      "代码不做 skill 匹配，请你结合任务语义判断哪些 skill 与当前任务相关、" +
      "各属 required 还是 optional，再用 record-skill 记录决策；只能从 available_skills 中选取。" +
      "涉及 UI 流程或浏览器 E2E 时，若 available_skills 中存在 agent-browser 则按 SKILL.md 约定记为 required。",
    count: skills.length,
    available_skills: skills,
  };
  if (disabled.length > 0) {
    // 仅诊断：这些 skill 装在磁盘但未启用，不可调用；需用户先 /plugin 启用，
    // 不可当作 available 记为 required（否则实现阶段调用会失败）。
    payload.installed_but_disabled = disabled.map((rec) => ({
      skill: rec.skill,
      scope: rec.scope,
      note: "插件已安装但未在 enabledPlugins 启用，当前会话不可调用；需先启用该插件，不要记为 required。",
    }));
  }
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
  // 装在磁盘但未启用：可解释“为什么看得到却调不动”，并给出可执行的修复提示。
  const disabledByName = new Map(discoverDisabledSkills().map((rec) => [rec.skill, rec]));
  const results = required.map((name) => {
    const rec = byName.get(name);
    if (rec) {
      return { skill: name, status: "installed", scope: rec.scope, path: rec.path };
    }
    const off = disabledByName.get(name);
    if (off) {
      return { skill: name, status: "disabled", scope: off.scope, path: off.path };
    }
    return { skill: name, status: "missing", scope: null, path: null };
  });
  // installed 之外都算不可用：missing（没装）与 disabled（装了没启用）都不可调用。
  const unavailable = results.filter((r) => r.status !== "installed");
  const missing = unavailable.filter((r) => r.status === "missing").map((r) => r.skill);
  const disabled = unavailable.filter((r) => r.status === "disabled").map((r) => r.skill);
  let instructions: string;
  if (unavailable.length === 0) {
    instructions = "全部 required skill 已安装且启用；按 SKILL.md 记录为 required，并在使用后补入实质参与证据。";
  } else {
    const parts: string[] = [];
    if (disabled.length > 0) {
      parts.push(
        `以下 required skill 已安装但未启用，当前会话不可调用：${disabled.join("、")}；` +
          "需用户先 /plugin 启用对应插件，不得由主会话静默顶替。",
      );
    }
    if (missing.length > 0) {
      parts.push(`以下 required skill 未安装：${missing.join("、")}。`);
    }
    parts.push(
      "不可用的 required skill：不得由主会话静默顶替其职责。请在 skill-usage 记录为阻塞（record-skill " +
        "--decision blocked/downgraded），或与用户确认降级方案后再继续。",
    );
    instructions = parts.join("");
  }
  const payload = {
    ok: unavailable.length === 0,
    required,
    results,
    missing,
    disabled,
    instructions,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (unavailable.length > 0) {
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
  const decision = reqChoice(flags, "decision", [
    "accepted",
    "declined",
    "required",
    "skipped",
    // downgraded：曾记为必需，但 skill 不可用且经用户确认后改用降级方案；
    // blocked：必需能力不可用且未解决，作为阻塞记录。两者都必须带 --reason，
    // 用于把“静默顶替”逼成显式、有理由的决定（见 validateUiCoverage）。
    "downgraded",
    "blocked",
  ]);
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

// ---- 结构化阶段执行记录（meta.executions 为真源，渲染到 skill-usage 的执行记录区）----

const EXECUTION_DECISIONS = ["participated", "skipped"];
const EXECUTION_SECTION_HEADING = "## 阶段执行记录";

function renderExecutionLine(rec: ExecutionRecord): string {
  const parts = [`- \`${rec.stage}\` — ${rec.executor} — ${rec.decision}`];
  if (rec.decision === "participated") {
    parts.push(`证据：${rec.evidence ?? ""}`);
  }
  if (rec.reason) {
    parts.push(`原因：${rec.reason}`);
  }
  return parts.join(" — ");
}

// 用 meta.executions 整体重渲染 skill-usage 的「阶段执行记录」区（替换该区，不碰其它区）。
function rewriteExecutionSection(taskDir: string, meta: Meta): void {
  const skillDoc = findSkillDoc(taskDir);
  if (!skillDoc) {
    return;
  }
  const p = path.join(taskDir, skillDoc);
  let content = readFileSync(p, "utf-8");
  const headingAt = content.indexOf(EXECUTION_SECTION_HEADING);
  if (headingAt === -1) {
    return;
  }
  const nextHeading = content.indexOf("\n## ", headingAt + EXECUTION_SECTION_HEADING.length);
  const sectionEnd = nextHeading === -1 ? content.length : nextHeading;
  const records = meta.executions ?? [];
  const body = records.length
    ? records.map(renderExecutionLine).join("\n")
    : "暂无阶段执行记录，由 submit / record-stage 登记。";
  const newSection = `${EXECUTION_SECTION_HEADING}\n\n${body}\n`;
  content = content.slice(0, headingAt) + newSection + content.slice(sectionEnd);
  writeFileSync(p, content, "utf-8");
}

// record-stage：不经 submit 落库文档时的阶段执行登记入口（如 final-verify 全走 check-test、
// 阶段被人工跳过、主会话兜底）。键 = 阶段；participated 必带 evidence，skipped 必带 reason，
// executor=main 必带 reason。
function cmdRecordStage(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const stage = reqChoice(flags, "stage", Object.keys(STAGE_POLICIES));
  const executor = reqChoice(flags, "executor", EXECUTORS);
  const decision = reqChoice(flags, "decision", EXECUTION_DECISIONS);
  const evidence = flags.evidence === undefined ? "" : String(flags.evidence);
  const reason = flags.reason === undefined ? "" : String(flags.reason);
  if (decision === "participated" && !evidence) {
    fail("record-stage participated 必须提供 --evidence（实质执行证据）");
  }
  if (decision === "skipped" && !reason) {
    fail("record-stage skipped 必须提供 --reason（跳过原因）");
  }
  if (executor === "main" && !reason) {
    fail("record-stage --executor main 必须提供 --reason（主会话兜底必须显式留痕）");
  }
  const meta = loadMeta(taskDir);
  meta.executions = meta.executions ?? [];
  const record: ExecutionRecord = { stage, executor, decision };
  if (evidence) {
    record.evidence = evidence;
  }
  if (reason) {
    record.reason = reason;
  }
  const idx = meta.executions.findIndex((rec) => rec.stage === stage);
  if (idx >= 0) {
    meta.executions[idx] = record;
  } else {
    meta.executions.push(record);
  }
  saveMeta(taskDir, meta);
  rewriteExecutionSection(taskDir, meta);
  console.log(pyJSON({ stage, executor, decision }));
}

// 修正任务是否涉及 UI 的标志。常用于 init 时未命中、但在 investigate/plan 才发现需要 UI/E2E 时
// 补开 UI 门禁（或反向关闭）。置 true 后 close 会强制 E2E 与 frontend-design 决策不被静默降级。
function cmdSetUi(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const value = reqChoice(flags, "value", ["true", "false"]);
  const meta = loadMeta(taskDir);
  meta.ui = value === "true";
  saveMeta(taskDir, meta);
  console.log(pyJSON({ ui: meta.ui }));
}

function testRoundDocs(taskDir: string): string[] {
  return readdirSync(taskDir)
    .filter((name) => name.includes("test-cases-round-") && name.endsWith(".md"))
    .sort();
}

// 测试轮文档前缀：已有轮次沿用现有前缀，首轮按 mode 取固定序号。
function testDocPrefix(taskDir: string, meta: Meta): string {
  const docs = testRoundDocs(taskDir);
  if (docs.length > 0) {
    return docs[0].split("test-cases-round-")[0];
  }
  const prefix = TEST_DOC_PREFIX[meta.mode];
  if (!prefix) {
    fail(`未知工作流模式：${meta.mode}`);
  }
  return prefix;
}

function nextTestDoc(taskDir: string, meta: Meta, roundNumber: number): string {
  return path.join(taskDir, `${testDocPrefix(taskDir, meta)}test-cases-round-${roundNumber}.md`);
}

function cmdNewTestRound(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const reason = reqStr(flags, "reason");
  const ifMissing = optBool(flags, "if-missing");
  const meta = loadMeta(taskDir);
  // 首轮：init 不再预生成测试用例文档，由实现/验证 agent 设计用例时创建 round-1；
  // 此后每次调用都开新一轮。--if-missing true 时已有轮次直接复用最新一轮
  // （写锁保证并发实现 agent 同时调用时只有第一个会真正建轮）。
  const isFirstRound = testRoundDocs(taskDir).length === 0;
  if (!isFirstRound && ifMissing) {
    console.log(nextTestDoc(taskDir, meta, Number(meta.test_rounds ?? 1)));
    return;
  }
  if (!isFirstRound) {
    meta.test_rounds = Number(meta.test_rounds ?? 1) + 1;
    saveMeta(taskDir, meta);
  }
  const values: Record<string, string> = {
    mode: meta.mode,
    topic: meta.topic,
    summary: meta.summary,
    date: todayISO(),
    round: String(meta.test_rounds),
    reason,
  };
  const p = nextTestDoc(taskDir, meta, Number(meta.test_rounds ?? 1));
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
  const meta = loadMeta(taskDir);
  const p = nextTestDoc(taskDir, meta, round);
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
  const newContent = content.replace(pattern, (_m, g1, g2, _g3, g4) => {
    count += 1;
    return `${g1}${mark}${g2}${statusText}${g4}${note ? ` — ${note}` : ""}`;
  });
  // 匹配不到时不静默追加（追加会造成重复用例且绕过矩阵格式）；
  // 新用例应先写进测试矩阵（set-doc/submit），再用 check-test 更新状态。
  if (count === 0) {
    fail(
      `测试用例不存在：${caseName}（请先在 ${path.basename(p)} 的「测试矩阵」登记该用例，再用 check-test 更新状态）`,
    );
  }
  writeFileSync(p, newContent, "utf-8");
  console.log(p);
}

// add-test-case：把单条用例追加进指定轮次的「测试矩阵」，生成行与 check-test 的
// 匹配格式一致。逐条追加 + 写锁，使并发实现 agent 登记用例不会像 set-doc 整篇
// 覆盖那样互相抹掉。
function cmdAddTestCase(flags: Flags): void {
  const taskDir = reqStr(flags, "task-dir");
  const round = reqInt(flags, "round");
  const caseName = reqStr(flags, "case");
  const desc = reqStr(flags, "desc").replace(/\s*\n\s*/g, " ").trim();
  if (!desc) {
    fail("参数 --desc 不能为空（建议格式：类型：unit/integration/e2e/regression — 目标：<一句话>）");
  }
  const meta = loadMeta(taskDir);
  const p = nextTestDoc(taskDir, meta, round);
  if (!existsSync(p)) {
    fail(`测试轮次不存在：${p}（先用 new-test-round 创建）`);
  }
  const content = readFileSync(p, "utf-8");
  // 查重只看可见正文：模板的 XFT-TODO 注释里有 TC-001 示例行，不能误判为已登记。
  if (new RegExp(`- \\[[ x]\\] ${escapeRegExp(caseName)} `).test(content.replace(/<!--[\s\S]*?-->/g, ""))) {
    fail(`测试用例已存在：${caseName}（用 check-test 更新状态）`);
  }
  const heading = "## 测试矩阵";
  const at = content.indexOf(heading);
  if (at === -1) {
    fail(`找不到「${heading}」章节：${p}`);
  }
  const line = `- [ ] ${caseName} — 待验证 — ${desc}`;
  const sectionStart = at + heading.length;
  const nextHeading = content.indexOf("\n## ", sectionStart);
  const sectionEnd = nextHeading === -1 ? content.length : nextHeading;
  // 首条用例落地时移除本节模板注释：示例行会被 check-test 的全文匹配误改，留着有害。
  const section = content.slice(sectionStart, sectionEnd).replace(/<!--[\s\S]*?-->\n?/g, "");
  const before = (content.slice(0, sectionStart) + section).replace(/\s+$/, "");
  const after = nextHeading === -1 ? "" : content.slice(sectionEnd);
  writeFileSync(p, `${before}\n${line}\n${after}`, "utf-8");
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
  // 实现任务的执行者就是通用 worker，owner 缺省即为 worker；coordination 类可显式标主会话。
  const owner = flags.owner === undefined ? "worker" : reqStr(flags, "owner");
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

// 可选布尔标志：缺省为 false；仅接受字符串 "true"/"false"，与现有字符串风格一致。
function optBool(flags: Flags, name: string): boolean {
  const v = flags[name];
  if (v === undefined) {
    return false;
  }
  if (v === "true") {
    return true;
  }
  if (v === "false") {
    return false;
  }
  return fail(`参数 --${name} 取值无效：${String(v)}（可选：true, false）`);
}

const HELP = `维护 .xft-comat 的轻量程序入口

用法：
  workflowctl.ts <子命令> [参数]

子命令：
  route --task <task>
  stage-policy --stage <stage> [--mode <mode>]
  next --task-dir <dir>
  init --topic <topic> --mode <mode> --summary <summary> [--ui true|false] [--runtime claude|codex]
  advance --task-dir <dir> --stage <stage>
  set-ui --task-dir <dir> --value <true|false>
  validate --task-dir <dir>
  status --task-dir <dir>
  close --task-dir <dir>
  set-doc --task-dir <dir> --doc <doc> (--from-file <file> | --content <text> | --stdin)
  submit --task-dir <dir> --stage <stage> --executor <worker|worker-ro|main> --doc <doc> (--from-file <file> | --content <text> | --stdin) [--evidence <text>] [--append true|false] [--reason <text>]
  record-decision --task-dir <dir> (--from-file <file> | --content <text> | --stdin)
  record-review --task-dir <dir> --blocking <true|false> [--summary <text>]
  skills list
  skills check --require <name>[,<name>...]
  record-skill --task-dir <dir> --skill <skill> --decision <accepted|declined|required|skipped|downgraded|blocked> --reason <reason> [--evidence <text>]
  record-stage --task-dir <dir> --stage <stage> --executor <worker|worker-ro|main> --decision <participated|skipped> [--evidence <text>] [--reason <text>]
  add-task --task-dir <dir> --title <title> [--owner <owner>（默认 worker）] [--id <id>] [--kind implementation|coordination] [--status todo|doing|done|blocked] [--deps <text>] [--evidence <text>]
  set-task --task-dir <dir> --id <id> [--title <text>] [--owner <text>] [--kind <kind>] [--status <status>] [--deps <text>] [--evidence <text>]
  new-test-round --task-dir <dir> --reason <reason> [--if-missing true|false]
  add-test-case --task-dir <dir> --round <n> --case <case> --desc <text>
  check-test --task-dir <dir> --round <n> --case <case> --status <passed|failed> [--note <text>]

说明：写类子命令对任务目录加写锁（.lock），供 implement/fix 阶段多个 worker 并发自录。
`;

function showHelp(): void {
  console.log(HELP);
}

// 改写 .xft-comat 状态的子命令集合：统一持任务目录写锁执行，
// 支撑 implement/fix 阶段多个 worker 并发自录（submit/set-task/check-test 等）。
const MUTATING_COMMANDS = new Set([
  "advance",
  "close",
  "set-doc",
  "submit",
  "record-decision",
  "record-review",
  "record-skill",
  "record-stage",
  "set-ui",
  "add-task",
  "set-task",
  "new-test-round",
  "add-test-case",
  "check-test",
]);

// 从原始参数中提取 --<name> 的值（兼容 --name value / --name=value），
// 仅用于在 parseFlags 之前定位写锁目录。
function rawFlagValue(rest: string[], name: string): string | null {
  const flag = `--${name}`;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === flag) {
      const value = rest[i + 1];
      return value === undefined || value.startsWith("--") ? null : value;
    }
    if (rest[i].startsWith(`${flag}=`)) {
      return rest[i].slice(flag.length + 1);
    }
  }
  return null;
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
  const lockTarget = MUTATING_COMMANDS.has(command) ? rawFlagValue(rest, "task-dir") : null;
  if (lockTarget && existsSync(lockTarget)) {
    withTaskLock(lockTarget, () => dispatch(command, rest));
  } else {
    dispatch(command, rest);
  }
}

function dispatch(command: string, rest: string[]): void {
  switch (command) {
    case "route":
      cmdRoute(parseFlags(rest, { allowedKeys: ["task"] }));
      break;
    case "stage-policy":
      cmdStagePolicy(parseFlags(rest, { allowedKeys: ["stage", "mode"] }));
      break;
    case "next":
      cmdNext(parseFlags(rest, { allowedKeys: ["task-dir"] }));
      break;
    case "init":
      cmdInit(parseFlags(rest, { allowedKeys: ["topic", "mode", "summary", "ui", "runtime"] }));
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
    case "submit":
      cmdSubmit(parseFlags(rest, {
        booleanKeys: ["stdin"],
        allowedKeys: ["task-dir", "stage", "executor", "doc", "from-file", "content", "stdin", "evidence", "append", "reason"],
      }));
      break;
    case "record-decision":
      cmdRecordDecision(parseFlags(rest, {
        booleanKeys: ["stdin"],
        allowedKeys: ["task-dir", "from-file", "content", "stdin"],
      }));
      break;
    case "record-review":
      cmdRecordReview(parseFlags(rest, {
        allowedKeys: ["task-dir", "blocking", "summary"],
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
    case "record-stage":
      cmdRecordStage(parseFlags(rest, {
        allowedKeys: ["task-dir", "stage", "executor", "decision", "evidence", "reason"],
      }));
      break;
    case "set-ui":
      cmdSetUi(parseFlags(rest, { allowedKeys: ["task-dir", "value"] }));
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
      cmdNewTestRound(parseFlags(rest, { allowedKeys: ["task-dir", "reason", "if-missing"] }));
      break;
    case "add-test-case":
      cmdAddTestCase(parseFlags(rest, {
        allowedKeys: ["task-dir", "round", "case", "desc"],
      }));
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
