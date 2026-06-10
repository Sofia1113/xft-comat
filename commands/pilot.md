---
description: 运行 xft-comat 程序驱动的 AI Coding 工作流，适用于新功能、bug 修复或重构。
---

# xft-comat Pilot

使用本命令驱动 xft-comat 工作流。pilot 是工作流的**指挥者**，只做四件事：**探索项目 → 调用需求澄清 skill → 调用路由 skill 并 init → 循环向脚本要"下一个阶段 + 该调用的 agent + 给 agent 的输入"，分派对应 agent，直到流程结束**。

pilot **不需要知道路由之后有哪些阶段**——阶段序列、每阶段该用哪个 agent、该读哪个方法论 skill、该给什么输入，全部由 `workflowctl.ts next` 返回。pilot 也**不写代码、不维护文档**：实质工作交给各阶段 agent 和脚本；agent 自己把产出和证据写回 `.xft-comat`。

用户请求如下：

```text
$ARGUMENTS
```

## 前置检查

1. 定位工作流控制脚本，下文用 `<script>` 指代它的绝对路径。首选插件安装根目录：

```bash
node "${CLAUDE_PLUGIN_ROOT}/workflow/pilot/scripts/workflowctl.ts" --help
```

`CLAUDE_PLUGIN_ROOT` 不可用或上述路径不存在时，再尝试当前仓库内的 `workflow/pilot/scripts/workflowctl.ts`（仅在 xft-comat 仓库本体内开发时存在）。`.xft-comat` 始终写入当前项目，与脚本所在位置无关。

**两者都失败时立即停止，向用户报告脚本缺失并请求脚本路径。** 脚本缺失不构成任何降级理由：不得在主会话"模拟"工作流、不得自创 mode 或阶段序列、不得绕过脚本创建 `.xft-comat`、不得直接实现业务代码。下文"探索"一节的 fallback 只覆盖探索这一个动作，与脚本缺失无关。

2. 探索和最小必要澄清完成前，不要运行 `route`、`init`，也不要创建 `.xft-comat`。

## 执行顺序

### 1. 探索

用 `project-explorer` agent 做只读项目探索，得到技术栈、相关文件、现有测试、风险信号和"代码无法回答的问题"。当前运行时没有 agent 分派能力时，在主会话做同等只读探索，并在 `00-routing.md` 记录 fallback。**该 fallback 仅限探索这一步**——它不允许跳过 workflowctl 流程，也不允许主会话接管后续任何实现/审查阶段。

### 2. 澄清

调用 `requirements-clarifier` skill。**优先使用 AskUserQuestion 等运行时提问工具**（推荐答案设为第一个选项），工具不可用时降级为文本提问。每轮只问一个高价值问题并给推荐答案；能从代码探索得到答案时不转问用户。持续澄清，直到目标、非目标、行为、边界和验收足够支持路由。

### 3. 路由（init 之前完成，路由两文档由主会话经脚本落库）

调用 `workflow-router` skill 得出唯一的工作流 mode，然后：

```bash
node <script> route --task "<原始请求 + 澄清答案 + 显式假设>"
node <script> init --topic "<短主题>" --mode <mode> --summary "<澄清后的摘要>" [--ui true] [--runtime claude|codex]
node <script> set-doc --task-dir <task-dir> --doc 00-routing.md --stdin
node <script> set-doc --task-dir <task-dir> --doc 01-requirements.md --stdin
```

`00-routing.md` 必须说明 mode、类型判断、复杂度逐维度评分、澄清如何影响路由、是否涉及 UI/E2E。接收/探索/澄清/路由发生在 init 之前，不进入状态机；init 后 `current_stage` 直接落在第一个实质阶段，无需额外 advance。

这是 pilot 用 `set-doc` 写入的仅有两个文档（路由/需求决策产物，此时尚无专职 agent）。其余阶段文档由各阶段 agent 经 `submit` 自录；唯一例外是 decide 阶段的 `record-decision`（用户交互产物，见下）。

### 4. 阶段循环（不枚举阶段）

反复执行，直到 `next` 返回 `done: true`：

```bash
node <script> next --task-dir <task-dir>
```

按返回的 JSON 处理：

- **`done: true`** → 跳出循环，进入下方"收尾"。
- **`skip_recommended: true`**（fix 阶段，review 无阻塞发现）→ 直接 `advance --stage <advance_to>`，继续循环。
- **`dispatch.kind == "main"` 且 `stage == "decide"`** → 主会话读取设计文档的"待用户拍板的决策点"，**用 AskUserQuestion 逐个向用户拿到拍板结论**（每次一个决策，附推荐答案），然后：

```bash
node <script> record-decision --task-dir <task-dir> --stdin   # 抉择写入设计文档开头
node <script> advance --task-dir <task-dir> --stage <advance_to>
```

- **`dispatch.kind == "main"` 且 `stage == "close"`** → 执行下方"收尾"。
- **`dispatch.kind == "agent"`** → 分派 `dispatch.agents` 中最合适的专职 agent。把以下内容**原样传给 agent**，让它自己干活并自录：
  - `dispatch.skill_paths`：该 agent 应先 `Read` 的方法论 SKILL.md 绝对路径。
  - `inputs`：`summary`、`contract`（本阶段该看重什么）、`docs`（**本阶段输入白名单文档**，非全量）；plan 阶段还含 `available_skills`，fix 阶段还含 `review` 结论。
  - `outputs_expected`、`quality_gate`：本阶段产物与质量门禁。
  - `record_instructions`、`script_path`、`task_dir`：agent 据此用 `submit` / `check-test` / `record-review` / `record-skill` / `set-task` 写回文档与证据。
  - 分派成功、agent 完成自录后，执行 `advance --task-dir <task-dir> --stage <advance_to>`，回到循环。
  - 分派失败（工具报错、立即返回 0 tool uses 等）时如实向用户报告，并用 `record-agent --decision skipped --reason "<失败原因>"` 留痕；主会话接手干活时**不得以该 agent 名义 `submit`**——证据必须反映真实执行者。

**plan 完成后、implement 开始前**：若 plan 产出建议了 optional/recommended skill，用 AskUserQuestion 向用户确认是否启用，确认结果用 `record-skill` 落库。required skill 在使用前由对应 agent 先验证可用：

```bash
node <script> skills check --require <skill>[,<skill>...]
```

主会话**不替 agent 跑** `submit`/`set-doc`/`record-skill`/`record-agent`/`add-task`/`set-task`/`check-test`/`record-review`（路由两文档与 record-decision 除外）——这些由该阶段 agent 自己执行。`02-design.md` / `02-design-note.md` 由 plan/decide 维护；review/fix 产出写入 review 专用文档，不能覆盖设计文档。

### 5. 收尾

```bash
node <script> validate --task-dir <task-dir>
node <script> close --task-dir <task-dir>
```

如果验证失败，把缺失证据或流程缺口**退回对应阶段 agent 补齐**，再复跑 `validate`/`close`。不要静默降级 required skill，也不要跳过 review/final-verify。

## 完成标准

只有满足以下条件，pilot 才算完成：

- 最终路由是在项目探索和需求澄清之后创建的。
- 每个执行阶段都由 `next` 指名的 agent 完成，且该 agent 自己写回了文档与参与证据（fix 被程序判定跳过除外）。
- review 阶段用 `record-review` 落库了审查结论；有阻塞发现时 fix 实际闭环。
- 阶段 required skill 有真实证据，或有明确的 downgraded/blocked 记录。
- 所有结构化 implementation task 均已由 owner 用 `set-task --status done --evidence ...` 标记完成。
- 最新一轮测试用例已完成勾选。
- `close` 成功，且 `workflow.json` 的 `current_stage` 为 `"close"`、`next` 返回 `done: true`。

## 汇报内容

- 工作流 mode 和理由。
- 各阶段 agent 完成的代码/文档变更。
- 已运行的测试和 E2E 验证。
- `.xft-comat` 任务目录。
- 剩余风险或阻塞项。

## 后续建议

只建议能直接延续当前工作流的后续动作，例如启用缺失的 required skill、确认被阻塞的产品决策，或运行更完整的验证套件。
