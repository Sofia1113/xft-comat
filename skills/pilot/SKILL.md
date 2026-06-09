---
name: pilot
description: Lightweight program-driven AI Coding workflow for non-trivial new features, bug fixes, and refactors that need controlled execution, workflow documentation, routed complexity, specialist agents, TDD, E2E validation, or persistent `.xft-comat` records. Use when the user explicitly asks for workflow/control/traceability, when the task is ambiguous or risky, or when it involves UI E2E, permissions/auth, API/data changes, multi-stage delivery, or agent coordination. For clearly simple one-shot edits with no need for traceability, prefer direct execution.
---

# xft-comat Workflow

用这个 skill 把 AI Coding 从“靠记忆管理流程”改成“按程序执行流程”。目标是轻量、可追踪、少读少写：Claude 只在当前阶段读取必要文档，所有 `.xft-comat` 目录维护都通过 `scripts/workflowctl.ts` 完成。

**全流程心智模型**：`receive → explore-and-clarify → route → [investigate →] [decide →] plan → implement → verify → review → fix → final-verify → close`。贯穿全程的两条主线：**澄清早于 route/init**、**审查早于 final-verify**。

## 快速导航

- [核心原则](#核心原则)：贯穿全程的不变量。
- [文件和脚本](#文件和脚本)：`workflowctl.ts` 入口与常用命令。
- [智能路由](#智能路由)：两步路由；评判框架和原子阶段以 `route` 命令输出为真源。
- [原子阶段](#原子阶段)：所有 workflow 只能拼接这些通用阶段。
- [五种固定工作流](#五种固定工作流)：每种模式的 Goal、关键门槛与必备 agent。
- [执行方式](#执行方式)：公共澄清 → 最终路由 → 设计与 skill → 实现 → 审查 → 验证 → 收尾。
- [轻量上下文策略](#轻量上下文策略)：只读当前阶段必要文档。
- [专职 agent 使用](#专职-agent-使用)：可用 agent 与阶段参与建议。
- [Agent 协作地图](#agent-协作地图)：谁的输出是谁的输入。
- [交付口径](#交付口径)：最终回复必须包含什么。

## 核心原则

- **优先交付**：先完成用户任务，流程只服务于交付，不抢主线注意力。
- **可见前导**：对需要多步推进或调用工具、agent 的任务，动手前先给用户一两句可见说明（当前模式与下一步），提升过程透明度；前导要短，服从“优先交付、不抢主线注意力”。
- **程序写入**：`.xft-comat` 只能通过 `workflowctl.ts` 写入或更新；可以读取，不能手动编辑其中任何文件。
- **主会话禁写**：工作流主会话只做编排、澄清、路由判断、agent 分派、证据核验和最终汇报；不得直接修改任何项目文件、代码文件、测试文件、配置文件或 `.xft-comat` 文档。主会话唯一允许产生文件变更的动作，是调用插件内 `skills/pilot/scripts/workflowctl.ts` 维护 `.xft-comat/`；业务代码和测试变更必须交给对应 specialist agent 或明确的外部 skill 执行。
- **澄清后路由**：开始时只能做脑内临时预判以决定澄清深度；禁止在对话一开始调用 `workflowctl.ts route`。先完成公共前置阶段 `receive` / `explore-and-clarify`，再用澄清后的任务摘要调用 `route` 和 `init` 写入最终 `00-routing.md`。
- **原子阶段统一**：同一语义只能有一个阶段名；不同 workflow 不得为“审查/最终验证/回归修复/测试实现”等相近含义另造阶段名。完整阶段词表以 `workflowctl.ts route` 输出的 `atomic_stages` 为准。
- **里程碑合并**：只推进关键里程碑，不为每个微步骤创建独立阶段；能合并记录的阶段合并记录。
- **无占位交付**：只创建和填写当前任务实际需要的文档章节；模板里的初始化提示必须在交付前改写为实际结论、证据或明确跳过原因，不能残留占位。
- **接收即探索澄清**：任务一进来主会话就并行启动轻量代码探索和首轮澄清，不必等任何路由命令；让用户第一时间看到问题与探索动作，而非等待。
- **提问工具优先**：需要用户澄清时优先使用运行时提供的提问工具（如 `AskUserQuestion`、`request_user_input`、`clarify`、`ask_user` 或等价工具）；工具不可用时才用普通文本提问，并说明这是降级。
- **拷问式澄清**：由主会话主持，一次只问最能消除不确定性的 1-3 个问题，根据回答继续追问，直到目标、非目标、业务规则、边界条件和验收标准足够明确；需要独立视角找盲点时，可让 specialist 出一份缺口清单或在收尾时审一次需求归档，但每轮问答仍由主会话直接进行，不绕 subagent 来回转述。
- **TDD 默认**：实现阶段先补或改测试，再实现，再跑测试。
- **UI 必走专用 skill**：有 UI 或端到端流程时，E2E 验证必须使用 `agent-browser` skill 并直接记录为 `required`；明确要求前端界面、视觉风格或交互体验时，`frontend-design` 必须实际参与设计约束或可用性检查，不能只加载或只记录。
- **skill 真实参与**：程序建议优先，只有会实质改变执行方式的可选 skill 才询问用户；凡记录为 `required` 的 skill，必须在会话中留下实质输出或操作证据。若某个 `required` skill 加载失败或不可用（如 `Unknown skill`），不得由主会话静默顶替其职责，必须先记录为阻塞、改派能承担该职责的 specialist，或与用户确认降级方案后再继续。
- **agent 原子职责**：每个 agent 只产出自己负责的判断、设计、实现、验证或审查结论，不维护工作流目录；目录维护只能由主 Claude 调用 `workflowctl.ts` 完成，conductor 只指出哪些结论应落到哪个文档。
- **hard 必有指挥与 specialist**：hard 流程必须体现 conductor/指挥者职责和 specialist agent 深度参与，不能主要由主会话独自完成；未使用应参与的 specialist 时，必须记录原因。具体到任务归属：实现、测试、前端落地、审查修复这类**实质编码任务的 owner 不得是主会话**，必须分派给对应 specialist（后端/测试归 `tdd-engineer`，前端归承担前端实现的 specialist，等等）；主会话只做编排、澄清、拍板和证据核验。conductor 在 `05-tasks.md` 里给实现类任务标 owner 时，禁止填"主 Claude/主会话"。
- **审查早于 final-verify**：实现后先在 `verify` 阶段运行基础冒烟测试使代码达到可审查状态，再由 `code-reviewer` 或 `code-review` skill 审查，修复后再进入 `final-verify` 阶段做完整验证、E2E 回归或等价验证。

## 文件和脚本

本 skill 作为插件 `xft-comat` 的一部分分发。脚本通过自身文件路径定位模板，与当前工作目录无关；`.xft-comat` 始终写入用户当前项目（脚本内部用 `process.cwd()` 解析）。在 Claude Code 中可继续用 `${CLAUDE_PLUGIN_ROOT}` 拼脚本路径；在 Codex 中使用已安装 skill 的实际文件路径，或从当前插件目录运行 `skills/pilot/scripts/workflowctl.ts`。

- `skills/pilot/scripts/workflowctl.ts`：唯一的工作流目录写入入口。
- `skills/pilot/templates/`：每类文档模板，脚本会按模式套用。
- `agents/*.md`：真实专职 agent 定义文件；安装插件后由运行时支持的 agent 发现机制加载，无需手动同步。

常用命令（`<plugin-root>` 为插件安装目录；`--task-dir` 等相对路径仍相对用户当前项目）：

```bash
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" route --task "<澄清后的任务摘要>"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" init --topic "<topic>" --mode feature-hard --summary "<任务摘要>"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" advance --task-dir .xft-comat/YYYY-MM-DD-topic --stage route
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" status --task-dir .xft-comat/YYYY-MM-DD-topic
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" set-doc --task-dir .xft-comat/YYYY-MM-DD-topic --doc 01-requirements.md --content "<短内容>"
printf '%s' "<长内容>" | node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" set-doc --task-dir .xft-comat/YYYY-MM-DD-topic --doc 01-requirements.md --stdin
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" skills list
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" skills check --require agent-browser,frontend-design
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" record-skill --task-dir .xft-comat/YYYY-MM-DD-topic --skill agent-browser --decision required --reason "UI E2E 验证必需" --evidence "agent-browser 已执行导航、表单操作和断言观察"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" record-agent --task-dir .xft-comat/YYYY-MM-DD-topic --agent architect --decision participated --evidence "产出 02-design 方案对比与用户决策点"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" record-agent --task-dir .xft-comat/YYYY-MM-DD-topic --agent e2e-verifier --decision skipped --reason "本任务无 UI/E2E"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" add-task --task-dir .xft-comat/YYYY-MM-DD-topic --title "实现权限校验中间件" --owner tdd-engineer --kind implementation --status doing
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" set-task --task-dir .xft-comat/YYYY-MM-DD-topic --id TASK-001 --status done --evidence "permission.spec.ts 4 passed"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" new-test-round --task-dir .xft-comat/YYYY-MM-DD-topic --reason "测试范围或失败假设变化，需要新一轮记录"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" check-test --task-dir .xft-comat/YYYY-MM-DD-topic --round 1 --case TC-001 --status passed --note "登录流程通过"
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" validate --task-dir .xft-comat/YYYY-MM-DD-topic
node "<plugin-root>/skills/pilot/scripts/workflowctl.ts" close --task-dir .xft-comat/YYYY-MM-DD-topic
```

## 智能路由

路由判断由你（模型）完成，不是代码。评判框架（任务类型定义、复杂度维度清单、分数区间）和原子阶段词表的**唯一真源是 `workflowctl.ts route` 的输出**——它会回显澄清后的任务并打印 `atomic_stages`、`mode_stage_tails`、`task_types`、`complexity_dimensions`、`scoring_bands`。本文不复述这些条目，避免与脚本双源漂移。

澄清后路由：

1. 接收任务后只做脑内 provisional route，用来决定要问多深、先探索哪些代码；不要调用 `route` 命令，也不要创建 `.xft-comat`。
2. 完成最小必要澄清后，把“原始任务 + 用户澄清 + 关键假设”压缩成任务摘要，再调用 `route --task "<澄清后的任务摘要>"` 读取评判框架。
3. 根据 `route` 输出和澄清结果判断最终 mode，再调用 `init --mode <final mode>` 创建任务目录，并立即 `advance --stage route`，让状态机显示公共前置阶段已完成、当前处于最终路由。
4. **CRITICAL**：最终路由必须在最小必要澄清之后写入。若澄清答案改变了任务类型、复杂度评分、风险或验收标准，必须在 `00-routing.md` 说明变化原因。只有任务已足够明确、不影响模式选择时，才可把 provisional route 直接确认为 final route。

判定顺序：先定任务类型，再按复杂度维度逐项自评计分定档。bugfix 与 refactor 优先于复杂度评分；若任务同时像 bugfix 和 feature，优先 `bugfix`，先在 `investigate` 建立复现和根因，修复若需新增能力再在 `plan` 里升级设计。

## 原子阶段

所有 workflow 阶段都由 `workflowctl.ts` 内置的通用原子阶段拼接而成。阶段名是审计与状态机语言，不表达具体任务类型；类型差异写进对应文档内容，而不是通过新阶段名表达。例如：

- bugfix 的复现和根因、refactor 的行为基线，都落在 `investigate`。
- hard 流程的用户关键决策（拍板架构方案），落在 `decide`。
- feature 的设计方案、bugfix 的修复策略、refactor 的重构方案，都落在 `plan`。
- 测试先行、基础测试和最小实现闭环，都落在 `implement`。
- 实现后的基础冒烟测试（确认可审查状态），落在 `verify`。
- 代码审查统一落在 `review`，审查发现闭环统一落在 `fix`。
- 最终自动化验证、E2E 回归、bug 回归验证和重构等价验证，都落在 `final-verify`。

## 五种固定工作流

完整阶段序列与文档清单的**唯一真源是脚本**：`init --mode <mode>` 按公共前置阶段、`route` 和各 mode 拼接的原子阶段生成 `state.md` 与各文档，阶段名可从生成的 `state.md` 读到，文档名直接在任务目录 glob。本文只给每种模式的 Goal、关键门槛与必备 agent，不复述阶段/文档列表。所有工作流共享门槛 **`review` 早于 `final-verify`**。

### feature-simple

- **Goal**：单点改动、需求清楚、低风险的快速可控交付。
- **关键门槛**：`plan` 内合并轻量设计、skill 检查和测试计划；代码审查可轻量，但仍应早于最终验证。
- **必备 agent**：通常不使用 specialist；仅 UI/E2E 需要 `agent-browser`，或存在明确审查风险时才引入。

### feature-medium

- **Goal**：多文件或有设计取舍、但边界可控的新需求。
- **关键门槛**：只有存在真实架构取舍时才要求多方案和用户确认，否则记录单一推荐方案即可；若存在 UI/设计要求，相关 design skill 必须实际参与。
- **必备 agent**：在需求、设计、测试或审查中至少选一个有独立判断价值的 specialist；存在真实架构取舍时使用 `architect`。

### feature-hard

- **Goal**：跨模块、高风险、需要指挥编排与多 specialist 深度参与的困难新需求。
- **关键门槛**：必须保留多轮澄清、最终路由、conductor 分派、architect 方案、用户关键决策、TDD 产物、代码审查闭环和最终 E2E；**`02-design.md` 的开头必须先写入用户最终抉择，再写架构师 agent 的方案**。这些产物分别落在通用的 `plan`、`decide`、`implement`、`review`、`fix`、`verify` 阶段，不另造 hard 专属阶段名。
- **必备 agent**：`conductor` 编排，`architect`、`tdd-engineer`、`code-reviewer` 按阶段实际产出；需求澄清由主会话主持，含 UI/E2E 时还须 `e2e-verifier` + `agent-browser`。

### bugfix

- **Goal**：先复现、定根因，再以回归测试保护修复的缺陷修复。
- **关键门槛**：必须先澄清现象和影响范围，再在 `investigate` 复现和定根因，最后补回归测试和修复；代码审查必须早于 `verify` 的最终回归验证。
- **必备 agent**：`bug-diagnostician` 建立复现和根因，再由 TDD/代码审查闭环；不同时分派 architect，除非修复升级为新设计。

### refactor

- **Goal**：保持外部行为不变、以安全网证明等价的结构改善。
- **关键门槛**：必须保留重构边界、禁止改变的行为、行为基线、安全网、代码审查和等价验证；不走新功能设计评审；代码审查早于 `verify` 的最终等价验证。
- **必备 agent**：`refactor-specialist` 建立行为基线、安全网和等价验证，并在最终等价验证前完成代码审查。

## 执行方式

按七段顺序推进，每段先看 Goal，再执行其下步骤；带 **CRITICAL**/**门槛** 的约束不可跳过。

### 公共澄清

Goal：主会话主持，逐轮消除不确定性。

1. **CRITICAL** 信息不足时禁止调用 `workflowctl.ts route`、禁止写最终 `00-routing.md`、禁止 `init`。任务一进来就并行启动轻量代码探索与首轮澄清；按任务风险做最小必要澄清。
2. 需要用户回答时优先调用提问工具。每轮 1-3 个问题；如果工具支持多问题，合并到一次工具调用；如果只支持单问题，按优先级逐个问。工具不可用时才用普通文本提问。
3. 逐轮问，不要一次抛出长问题清单；每轮问题必须服务于消除当前最大不确定性；仍不明确的内容只能记录为显式假设或阻塞问题。
4. 需要独立视角找盲点时，可让 specialist 出一份缺口清单或在收尾时审一次需求归档，但每轮问答由主会话直接进行。

### 最终路由

Goal：澄清后读取路由框架，创建并记录最终工作流。

5. 将用户原始任务、澄清答案、仍保留的显式假设压缩为任务摘要，再调用 `route --task "<澄清后的任务摘要>"`。不要把未澄清的首条用户消息直接传给 `route`。
6. 用 `route` 输出的评判框架判断最终 mode，然后调用 `init --mode <final mode>` 创建任务目录。topic 用短横线命名，格式由脚本生成：`YYYY-MM-DD-topic`。
7. `init` 后立即调用 `advance --stage route`，再用 `set-doc` 写入 `00-routing.md` 和 `01-requirements.md`；`00-routing.md` 必须说明 final route 的理由，以及哪些澄清答案影响了类型、复杂度或风险判断。
8. 只在关键里程碑变化时调用 `advance`；同一里程碑内的子步骤写入对应文档，不单独推进状态机。`advance` 按阶段顺序推进：脚本会拒绝向前跳过任何未完成的实质阶段（`route` 之后），把“审查早于 final-verify”变成程序门禁，因此即使某阶段工作被轻量合并也要顺序 `advance` 经过它，不能跳。验证或审查发现问题需要重做时，可 `advance` 回退到更早阶段，其后阶段会自动重置为未完成。

### 设计与 skill

Goal：定方案与必要 skill，安排 specialist 参与。

9. 实现前用 `skills list` 取得可用 skill 目录，由你结合任务语义判断哪些相关、各属 `required` 还是 `optional`：UI/E2E 直接记录 `agent-browser` 为 `required`；前端视觉/交互任务应让 `frontend-design` 实际参与；其他候选仅在会实质改变执行方式时询问用户。任何拟记为 `required` 的 skill 落定前先用 `skills check --require <name>[,<name>...]` 确认已安装；若返回 `missing`，不得由主会话静默顶替——记为阻塞、改派能承担该职责的 specialist，或与用户确认降级方案后再继续。
10. hard 流程由 conductor 协调必要 specialist：architect、tdd-engineer、e2e-verifier、code-reviewer 按阶段参与；需求澄清由主会话主持。每个 specialist 的参与情况用 `record-agent` 程序登记：实际参与记 `--decision participated --evidence <实质证据>`，未使用记 `--decision skipped --reason <原因>`；hard 流程的 `conductor`/`architect`/`tdd-engineer`/`code-reviewer` 必须各有一条，否则 close 会被拦。

### 实现

Goal：TDD 实现到可审查状态。

11. **门槛** 实现阶段先补或改测试，再实现；这些文件变更必须由对应 specialist agent 或外部 skill 完成，主会话不得使用 Write/Edit/MultiEdit/apply_patch、shell 重定向、heredoc、`cat >`、脚本生成等方式直接修改项目文件。任务拆分用 `add-task` / `set-task` 程序登记到 tasks 文档（不手写），随实现进度更新 `--status`；hard 流程必须登记结构化任务，且实现、测试、前端落地、审查修复类任务（`--kind implementation`）的 `--owner` 必须是 specialist，不得填主会话，编排/澄清/拍板/核验类用 `--kind coordination`。

### 冒烟验证

Goal：实现后快速确认代码可审查。

12. `verify` 阶段只运行基础冒烟测试，目的是确认代码在可审查状态；不在此阶段做完整 E2E 或跑全量回归。

### 审查

Goal：审查早于 final-verify 并闭环。

13. 代码审查阶段优先使用 `code-reviewer`；需要通用能力时明确调用 `code-review` skill。审查发现必须补回归测试、修复并复跑。**门槛**（hard 流程）：审查 findings 必须回交原实现 specialist（后端/测试归 `tdd-engineer`）在 subagent 内完成"补回归测试 → 修复 → 复跑转绿"，主会话只核验修复 diff 与回归证据，不得自行下场编辑业务代码或测试。

### 最终验证

Goal：审查修复后做完整 E2E 回归。

14. `final-verify` 发生在审查修复之后；若包含 UI/E2E，使用 `e2e-verifier` 和 `agent-browser` 验证用户路径。
15. 验证失败先在当前 round 记录失败并修复重验；只有测试范围、验收标准或失败假设发生变化，需要保留独立轮次时才调用 `new-test-round`。

### 收尾

Goal：程序化 close 并如实交付。

16. close 前必须运行 `validate` 或 `close` 命令检查工作流记录：不得残留模板占位，required skill 必须有实质参与证据，hard 流程必须记录 required specialist 的参与或跳过原因，`review` 必须早于 `final-verify`，且最新一轮测试用例不得残留 `待验证` 或 `未通过`（用 `check-test` 打勾，失败假设变化时用 `new-test-round` 开新一轮）。
17. close 阶段必须通过 `close` 命令把工作流状态推进到 completed，汇报交付结果、验证情况、残余风险和文档目录路径；最终回复不得与 `workflow.json` 状态矛盾。

## 轻量上下文策略

- 只读取当前阶段需要的文档：澄清阶段先不读 `.xft-comat`（尚未 init），最终路由阶段读取 `00-routing.md` 和 `01-requirements.md` 并通过 `workflowctl.ts set-doc` 更新，设计阶段读 `01-requirements.md`，实现阶段读 requirements/design/tasks/test-cases，verify/final-verify 阶段读 test-cases 和最近失败记录。
- 需要快速对齐进度（当前阶段、任务完成度、测试通过情况、文档占位、收尾还差什么）时，优先用 `status --task-dir` 一次性取结构化全貌，而不是逐个打开 `.xft-comat` 文档。
- 不要求每个 agent 读取整个 `.xft-comat` 目录。
- agent 输出要短而结构化，主 Claude 决定是否调用 `workflowctl.ts` 写入目录。
- 状态机只记录阶段列表和状态，不记录长篇输入输出。

## 专职 agent 使用

真实 agent 定义位于插件根的 `agents/*.md`，安装并启用插件 `xft-comat` 后由运行时支持的 agent 发现机制加载；各 agent 的名称和职责由其 frontmatter 提供。任务达到中等以上、需要独立判断、或用户明确要求 agent 团队时优先使用；即使是简单任务，主会话也不得直接编辑项目文件，若需要代码或测试变更必须交给合适的 specialist agent 或外部 skill，并仍遵守 TDD、代码审查和目录维护规则。

阶段参与建议：

- `feature-simple` 通常不使用 specialist agent，除非 UI/E2E 需要 `agent-browser` 或存在明确审查风险。
- `feature-medium` 至少在需求、设计、测试或审查中选择有独立判断价值的 specialist；存在真实架构取舍时使用 `architect`。
- `feature-hard` 必须由 `conductor` 协调，并让 `architect`、`tdd-engineer`、`code-reviewer` 按阶段实际产出；需求澄清由主会话主持，包含 UI/E2E 时还必须使用 `e2e-verifier` 和 `agent-browser`。
- `bugfix` 优先使用 `bug-diagnostician` 建立复现和根因，再由 TDD/代码审查闭环；不同时分派 architect，除非修复升级为新设计。
- `refactor` 优先使用 `refactor-specialist` 建立行为基线、安全网和等价验证，并在最终等价验证前完成代码审查。
- `skill-scout` 仅在 `workflowctl.ts skills list` 给出目录后，skill 选择确实模糊时使用。

分派 specialist 时给出明确任务、要求短而结构化的输出、并指明结论写入哪个文档。记录要求：凡标记为 required 的 skill 必须在会话和 `skill-usage.md` 中留下实质参与证据；specialist 的参与或跳过用 `record-agent` 结构化登记（`participated` 带证据、`skipped` 带原因），hard 流程必备 specialist 缺记录会被 `validate`/`close` 拦截。

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
