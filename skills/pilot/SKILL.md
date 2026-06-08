---
name: pilot
description: Lightweight program-driven AI Coding workflow for non-trivial new features, bug fixes, and refactors that need controlled execution, workflow documentation, routed complexity, specialist agents, TDD, E2E validation, or persistent `.xft-comat` records. Use when the user explicitly asks for workflow/control/traceability, when the task is ambiguous or risky, or when it involves UI E2E, permissions/auth, API/data changes, multi-stage delivery, or agent coordination. For clearly simple one-shot edits with no need for traceability, prefer direct execution.
---

# xft-comat Workflow

用这个 skill 把 AI Coding 从“靠记忆管理流程”改成“按程序执行流程”。目标是轻量、可追踪、少读少写：Claude 只在当前阶段读取必要文档，所有 `.xft-comat` 目录维护都通过 `scripts/workflowctl.py` 完成。

**全流程心智模型**：`接收任务即并行探索代码+迭代澄清 → 写最终路由 → 设计 → TDD 实现 → 基础测试到可审查 → 代码审查 → 修复回归 → 最终验证/E2E → 收尾 close`。贯穿全程的两条主线：**澄清早于最终路由**、**审查早于最终验证**。

## 快速导航

- [核心原则](#核心原则)：贯穿全程的不变量。
- [文件和脚本](#文件和脚本)：`workflowctl.py` 入口与常用命令。
- [智能路由](#智能路由)：两步路由；评判框架以 `route` 命令输出为真源。
- [五种固定工作流](#五种固定工作流)：每种模式的 Goal、关键门槛与必备 agent。
- [执行方式](#执行方式)：路由 → 澄清 → 设计与 skill → 实现 → 审查 → 验证 → 收尾。
- [轻量上下文策略](#轻量上下文策略)：只读当前阶段必要文档。
- [专职 agent 使用](#专职-agent-使用)：可用 agent 与阶段参与建议。
- [Agent 协作地图](#agent-协作地图)：谁的输出是谁的输入。
- [交付口径](#交付口径)：最终回复必须包含什么。

## 核心原则

- **优先交付**：先完成用户任务，流程只服务于交付，不抢主线注意力。
- **可见前导**：对需要多步推进或调用工具、agent 的任务，动手前先给用户一两句可见说明（当前模式与下一步），提升过程透明度；前导要短，服从“优先交付、不抢主线注意力”。
- **程序写入**：`.xft-comat` 只能通过 `workflowctl.py` 写入或更新；可以读取，不能手动编辑其中任何文件。
- **两步路由**：开始时只能做临时预判以决定澄清深度；对需求明显模糊或会影响复杂度的任务，必须先做最小必要澄清，再写入最终 `00-routing.md`。
- **里程碑合并**：只推进关键里程碑，不为每个微步骤创建独立阶段；能合并记录的阶段合并记录。
- **无占位交付**：只创建和填写当前任务实际需要的文档章节；模板里的初始化提示必须在交付前改写为实际结论、证据或明确跳过原因，不能残留占位。
- **接收即探索澄清**：任务一进来主会话就并行启动轻量代码探索和首轮澄清，不必等任何路由命令；让用户第一时间看到问题与探索动作，而非等待。
- **拷问式澄清**：由主会话主持，一次只问最能消除不确定性的 1-3 个问题，根据回答继续追问，直到目标、非目标、业务规则、边界条件和验收标准足够明确；需要独立视角找盲点时，可让 specialist 出一份缺口清单或在收尾时审一次需求归档，但每轮问答仍由主会话直接进行，不绕 subagent 来回转述。
- **TDD 默认**：实现阶段先补或改测试，再实现，再跑测试。
- **UI 必走专用 skill**：有 UI 或端到端流程时，E2E 验证必须使用 `agent-browser` skill 并直接记录为 `required`；明确要求前端界面、视觉风格或交互体验时，`frontend-design` 必须实际参与设计约束或可用性检查，不能只加载或只记录。
- **skill 真实参与**：程序建议优先，只有会实质改变执行方式的可选 skill 才询问用户；凡记录为 `required` 的 skill，必须在会话中留下实质输出或操作证据。
- **agent 原子职责**：每个 agent 只产出自己负责的判断、设计、实现、验证或审查结论，不维护工作流目录；目录维护由主 Claude 或 conductor 通过程序完成。
- **hard 必有指挥与 specialist**：hard 流程必须体现 conductor/指挥者职责和 specialist agent 深度参与，不能主要由主会话独自完成；未使用应参与的 specialist 时，必须记录原因。
- **审查早于最终验证**：实现后先跑必要基础测试使代码达到可审查状态，再由 `xft-comat-code-reviewer` 或 `code-review` skill 审查，修复后再做完整验证和 E2E 回归。

## 文件和脚本

本 skill 作为插件 `xft-comat` 的一部分分发。脚本一律通过插件根环境变量 `${CLAUDE_PLUGIN_ROOT}` 定位，与当前工作目录无关；`.xft-comat` 始终写入用户当前项目（脚本内部用 `Path.cwd()` 解析）。

- `${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py`：唯一的工作流目录写入入口。
- `${CLAUDE_PLUGIN_ROOT}/skills/pilot/templates/`：每类文档模板，脚本会按模式套用。
- `${CLAUDE_PLUGIN_ROOT}/agents/*.md`：真实专职 agent 定义文件；安装插件后由 Claude Code 自动加载，无需手动同步。

常用命令（`${CLAUDE_PLUGIN_ROOT}` 为插件安装目录，由 Claude Code 在运行时注入到环境变量；`--task-dir` 等相对路径仍相对用户当前项目）：

```bash
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" route --task "<用户任务>"
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" init --topic "<topic>" --mode feature-hard --summary "<任务摘要>"
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" advance --task-dir .xft-comat/YYYY-MM-DD-topic --stage final-route
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" set-doc --task-dir .xft-comat/YYYY-MM-DD-topic --doc 01-requirements.md --content "<短内容>"
printf '%s' "<长内容>" | python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" set-doc --task-dir .xft-comat/YYYY-MM-DD-topic --doc 01-requirements.md --stdin
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" skills list
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" record-skill --task-dir .xft-comat/YYYY-MM-DD-topic --skill agent-browser --decision required --reason "UI E2E 验证必需" --evidence "agent-browser 已执行导航、表单操作和断言观察"
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" new-test-round --task-dir .xft-comat/YYYY-MM-DD-topic --reason "测试范围或失败假设变化，需要新一轮记录"
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" check-test --task-dir .xft-comat/YYYY-MM-DD-topic --round 1 --case TC-001 --status passed --note "登录流程通过"
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" validate --task-dir .xft-comat/YYYY-MM-DD-topic
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" close --task-dir .xft-comat/YYYY-MM-DD-topic
```

## 智能路由

路由判断由你（模型）完成，不是代码。评判框架（任务类型定义、复杂度维度清单、分数区间）的**唯一真源是 `workflowctl.py route` 的输出**——它会回显任务并打印 `task_types`、`complexity_dimensions`、`scoring_bands`。本文不复述这些条目，避免与脚本双源漂移。

两步路由：

1. 读 `route` 输出后结合任务语义形成 provisional route。provisional route 只用于决定澄清深度和临时阶段策略，不能作为最终 `00-routing.md` 结论。
2. **CRITICAL**：最终路由必须在最小必要澄清之后写入。若澄清答案改变了任务类型、复杂度评分、风险或验收标准，必须在 `00-routing.md` 说明变化原因。只有任务已足够明确、不影响模式选择时，才可把 provisional route 直接确认为 final route。

判定顺序：先定任务类型，再按复杂度维度逐项自评计分定档。bugfix 与 refactor 优先于复杂度评分；若任务同时像 bugfix 和 feature，优先 `bugfix`，先建立复现和根因，修复若需新增能力再在修复方案里升级设计。

## 五种固定工作流

完整阶段序列与文档清单的**唯一真源是脚本**：`init --mode <mode>` 按 `MODE_STAGES`/`MODE_DOCS` 生成 `state.md` 和各文档，阶段名可从生成的 `state.md` 读到，文档名直接在任务目录 glob。本文只给每种模式的 Goal、关键门槛与必备 agent，不复述阶段/文档列表。所有工作流共享门槛 **代码审查早于最终验证**。

### feature-simple

- **Goal**：单点改动、需求清楚、低风险的快速可控交付。
- **关键门槛**：`plan` 内合并轻量设计、skill 检查和测试计划；代码审查可轻量，但仍应早于最终验证。
- **必备 agent**：通常不使用 specialist；仅 UI/E2E 需要 `agent-browser`，或存在明确审查风险时才引入。

### feature-medium

- **Goal**：多文件或有设计取舍、但边界可控的新需求。
- **关键门槛**：只有存在真实架构取舍时才要求多方案和用户确认，否则记录单一推荐方案即可；若存在 UI/设计要求，相关 design skill 必须实际参与。
- **必备 agent**：在需求、设计、测试或审查中至少选一个有独立判断价值的 specialist；存在真实架构取舍时使用 `xft-comat-architect`。

### feature-hard

- **Goal**：跨模块、高风险、需要指挥编排与多 specialist 深度参与的困难新需求。
- **关键门槛**：必须保留多轮澄清、最终路由、conductor 分派、architect 方案、用户关键决策、TDD 产物、代码审查闭环和最终 E2E；**`02-design.md` 的开头必须先写入用户最终抉择，再写架构师 agent 的方案**。
- **必备 agent**：`xft-comat-conductor` 编排，`xft-comat-architect`、`xft-comat-tdd-engineer`、`xft-comat-code-reviewer` 按阶段实际产出；需求澄清由主会话主持，含 UI/E2E 时还须 `xft-comat-e2e-verifier` + `agent-browser`。

### bugfix

- **Goal**：先复现、定根因，再以回归测试保护修复的缺陷修复。
- **关键门槛**：必须先澄清现象和影响范围，再复现和根因，最后补回归测试和修复；代码审查必须早于最终回归验证。
- **必备 agent**：`xft-comat-bug-diagnostician` 建立复现和根因，再由 TDD/代码审查闭环；不同时分派 architect，除非修复升级为新设计。

### refactor

- **Goal**：保持外部行为不变、以安全网证明等价的结构改善。
- **关键门槛**：必须保留重构边界、禁止改变的行为、行为基线、安全网、代码审查和等价验证；不走新功能设计评审；代码审查早于最终等价验证。
- **必备 agent**：`xft-comat-refactor-specialist` 建立行为基线、安全网和等价验证，并在最终等价验证前完成代码审查。

## 执行方式

按七段顺序推进，每段先看 Goal，再执行其下步骤；带 **CRITICAL**/**门槛** 的约束不可跳过。

### 路由

Goal：先临时预判，澄清后再写入最终路由。

1. 用 `route` 拿到任务文本和评判框架，先形成 provisional route；若信息不足，先不要写最终 `00-routing.md`。
2. 澄清足够后，用最终 mode 调用 `init --mode <final mode>` 创建任务目录。topic 用短横线命名，格式由脚本生成：`YYYY-MM-DD-topic`。
3. 写入 `00-routing.md` 时必须说明 final route 的理由，以及哪些澄清答案影响了类型、复杂度或风险判断。
4. 只在关键里程碑变化时调用 `advance`；同一里程碑内的子步骤写入对应文档，不单独推进状态机。

### 澄清

Goal：主会话主持，逐轮消除不确定性。

5. **CRITICAL** 信息不足时禁止先写最终 `00-routing.md`。任务一进来就并行启动轻量代码探索与首轮澄清，不必等任何路由命令。按任务风险做最小必要澄清；需要独立视角找盲点时，可让 specialist 出一份缺口清单或在收尾时审一次需求归档，但每轮问答由主会话直接进行。
6. 逐轮问，不要一次抛出长问题清单；每轮问题必须服务于消除当前最大不确定性；仍不明确的内容只能记录为显式假设或阻塞问题。
7. 需要写入文档时，优先用 `set-doc --content` 或 `set-doc --stdin` 写入；仅当内容很长或需要本地编辑时才使用 `--from-file`。

### 设计与 skill

Goal：定方案与必要 skill，安排 specialist 参与。

8. 实现前用 `skills list` 取得可用 skill 目录，由你结合任务语义判断哪些相关、各属 `required` 还是 `optional`：UI/E2E 直接记录 `agent-browser` 为 `required`；前端视觉/交互任务应让 `frontend-design` 实际参与；其他候选仅在会实质改变执行方式时询问用户。
9. hard 流程由 conductor 协调必要 specialist：architect、tdd-engineer、e2e-verifier、code-reviewer 按阶段参与；需求澄清由主会话主持，未使用应参与 agent 必须记录原因。

### 实现

Goal：TDD 实现到可审查状态。

10. **门槛** 实现阶段先补或改测试，再实现；实现后只运行足以让代码达到可审查状态的基础测试，不把完整 E2E 当成审查前置条件。

### 审查

Goal：审查早于最终验证并闭环。

11. 代码审查阶段优先使用 `xft-comat-code-reviewer`；需要通用能力时明确调用 `code-review` skill。审查发现必须补回归测试、修复并复跑。

### 验证

Goal：审查修复后做最终验证与 E2E 回归。

12. 最终验证发生在审查修复之后；若包含 UI/E2E，使用 `xft-comat-e2e-verifier` 和 `agent-browser` 验证用户路径。
13. 验证失败先在当前 round 记录失败并修复重验；只有测试范围、验收标准或失败假设发生变化，需要保留独立轮次时才调用 `new-test-round`。

### 收尾

Goal：程序化 close 并如实交付。

14. close 前必须运行 `validate` 或 `close` 命令检查工作流记录：不得残留模板占位，required skill 必须有实质参与证据，hard 流程必须记录 required specialist 的参与或跳过原因，审查必须早于最终验证。
15. close 阶段必须通过 `close` 命令把工作流状态推进到 completed，汇报交付结果、验证情况、残余风险和文档目录路径；最终回复不得与 `workflow.json` 状态矛盾。

## 轻量上下文策略

- 只读取当前阶段需要的文档：需求阶段读 `00-routing.md`，设计阶段读 `01-requirements.md`，实现阶段读 requirements/design/tasks/test-cases，验证阶段读 test-cases 和最近失败记录。
- 不要求每个 agent 读取整个 `.xft-comat` 目录。
- agent 输出要短而结构化，主 Claude 决定是否写入目录。
- 状态机只记录阶段列表和状态，不记录长篇输入输出。

## 专职 agent 使用

真实 agent 定义位于插件根的 `agents/*.md`，安装并启用插件 `xft-comat` 后由 Claude Code 自动发现加载，无需手动同步；各 agent 的名称（统一 `xft-comat-` 前缀）和职责由其 frontmatter 提供，会出现在 `/agents` 列表中。当任务达到中等以上、需要独立判断、或用户明确要求 agent 团队时优先使用；简单任务可由主 Claude 直接执行，但仍遵守 TDD、代码审查和目录维护规则。

阶段参与建议：

- `feature-simple` 通常不使用 specialist agent，除非 UI/E2E 需要 `agent-browser` 或存在明确审查风险。
- `feature-medium` 至少在需求、设计、测试或审查中选择有独立判断价值的 specialist；存在真实架构取舍时使用 `xft-comat-architect`。
- `feature-hard` 必须由 `xft-comat-conductor` 协调，并让 `xft-comat-architect`、`xft-comat-tdd-engineer`、`xft-comat-code-reviewer` 按阶段实际产出；需求澄清由主会话主持，包含 UI/E2E 时还必须使用 `xft-comat-e2e-verifier` 和 `agent-browser`。
- `bugfix` 优先使用 `xft-comat-bug-diagnostician` 建立复现和根因，再由 TDD/代码审查闭环；不同时分派 architect，除非修复升级为新设计。
- `refactor` 优先使用 `xft-comat-refactor-specialist` 建立行为基线、安全网和等价验证，并在最终等价验证前完成代码审查。
- `xft-comat-skill-scout` 仅在 `workflowctl.py skills list` 给出目录后，skill 选择确实模糊时使用。

分派 specialist 时给出明确任务、要求短而结构化的输出、并指明结论写入哪个文档。记录要求：凡标记为 required 的 agent 或 skill，必须在会话和 `skill-usage.md` 中留下实质参与证据；未使用应参与的 specialist 必须说明原因。

## Agent 协作地图

谁的输出是谁的输入：

- **feature**：主会话主持澄清 →(01-requirements)→ `architect` →(02-design)→ `tdd-engineer` →(实现+基础测试)→ `code-reviewer` →(findings)→ `tdd-engineer` 修复 →(回归)→ `e2e-verifier`；`conductor` 横向编排并跟踪证据，`skill-scout` 在实现前横切。
- **bugfix**：`bug-diagnostician` →(02-reproduction/03-root-cause)→ `tdd-engineer`（回归测试优先）→ `code-reviewer` → 回归/E2E 验证。
- **refactor**：`refactor-specialist` →(行为基线/02-refactor-plan/03-safety-net)→ 小步重构 → `code-reviewer` → 等价验证。

## 交付口径

最终回复包括：

- 采用的工作流模式和一句理由。
- 实际完成的代码或文档变更。
- 已运行的测试和 E2E 验证结果。
- 工作流记录目录路径。
- 未完成项或残余风险，没有就明确说没有发现。
