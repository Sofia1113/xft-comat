---
name: plugin-tester
version: 0.3.0
description: 端到端测试 xft-comat 工作流插件（/pilot command + workflowctl.ts + 通用 worker agents + 方法论 skills）。在 tmux 里启动隔离的 Codex 子会话、通过 --plugin-dir 加载当前 xft-comat 插件、用预置 prompt 覆盖 feature-simple / feature-medium / feature-hard / bugfix / refactor 五种工作流，实时监控会话、模拟澄清和设计决策、检查 .xft-comat 是否只由 workflowctl.ts 维护、判断路由、TDD、worker/skill 分派和验证闭环是否合理。用户说“测试 xft-comat 插件”“跑工作流插件 E2E”“验证 xft-comat workflow”“重跑插件回归”“验证所有 workflow/mode”时使用。
---

# xft-comat Plugin Tester

测 `xft-comat` 插件本身的端到端行为。这个 skill 不是用 `xft-comat` 来开发业务需求，而是把 `xft-comat` 当被测系统，在隔离 sandbox 里跑真实 Codex 子会话，观察它是否按插件约定推进工作流。

权威来源按优先级读取：

1. `.codex-plugin/plugin.json` — 插件身份和分发信息。
2. `commands/pilot.md` — 主 workflow command 的行为契约。
3. `workflow/pilot/scripts/workflowctl.ts` — `.xft-comat` 的唯一写入口和命令契约。
4. `agents/*.md` — 通用 worker agent（worker / worker-ro）的执行协议。
5. 本 skill 的 `references/` — 测试视角的 prompt 清单和 tmux 交互协议。

如果本文件与插件源码不一致，以插件源码为准，并回头修这个 tester skill。

## 何时使用

用户要求以下任一事项时使用：

- “测试 xft-comat 插件” / “跑工作流插件回归” / “验证所有 workflow/mode”。
- “改了 `pilot`（主 command）/ `workflowctl.ts` / agents / skills 之后跑一遍看看”。
- “重跑那个 bugfix/feature-hard/refactor 场景”。

不使用这个 skill 的情况：

- 用户只是想用 `xft-comat` 完成某个真实项目任务 → 调用 `/pilot`。
- 用户只问插件设计或代码结构 → 直接读 `commands/pilot.md`、`workflow/pilot/`、`agents/`、`skills/` 和脚本回答。

## 固定路径

| 路径 | 用途 |
|------|------|
| `~/WorkSpace/xft-comat` | 默认被测插件源码（`XFT_COMAT_PLUGIN`） |
| `~/WorkSpace/xft-comat-sandbox` | 默认测试 sandbox（`XFT_COMAT_SANDBOX`），首次跑 `obt-init` 创建 |
| `~/WorkSpace/xft-comat-sandbox/.claude-test-home` | 被测会话的隔离 `CLAUDE_CONFIG_DIR`（obt-init 生成，gitignored），脱离用户全局 `~/.claude` |
| `.agents/skills/plugin-tester/scripts/obt-*` | 测试脚本，名称沿用 `obt-*` 以兼容旧调用 |
| `.agents/skills/plugin-tester/scripts/fixtures/<name>/` | bugfix / refactor 预埋代码，`obt-reset --fixture <name>` 种入 sandbox |
| `.agents/skills/plugin-tester/references/` | 测试 prompt 清单和 tmux 交互协议 |
| `/tmp/xft-comat-test-<session>.log` | tmux pipe-pane 全量日志，Monitor 监听它 |

脚本默认会从自身位置推导当前插件根；环境不同可显式传 env：

```bash
XFT_COMAT_PLUGIN=/Users/sofia/WorkSpace/xft-comat \
XFT_COMAT_SANDBOX=/Users/sofia/WorkSpace/xft-comat-sandbox \
.agents/skills/plugin-tester/scripts/obt-start "<prompt>"
```

## 工具脚本速查

| 命令 | 作用 |
|------|------|
| `obt-init` | 首次创建空壳 sandbox（git init + 最小 Node 项目 + baseline commit）+ 隔离 `.claude-test-home` |
| `obt-reset [--fixture <name>]` | sandbox `git reset --hard` 到 baseline + `git clean -fdx`（保留隔离 home），清掉 `.xft-comat/` 和产物；每次重跑前必跑。`--fixture bugfix\|refactor` 额外种入预埋代码并 commit |
| `obt-start "<prompt>"` | 起 tmux 会话、隔离 `CLAUDE_CONFIG_DIR` + `--plugin-dir` 加载插件、**核验模型**后发送 `${XFT_COMAT_ENTRYPOINT:-/pilot} <prompt>` |
| `obt-snap [N]` | 抓当前 tmux 屏幕末 N 行（默认 200） |
| `obt-send <text\|@key> ...` | 给 tmux 发输入；支持 `@Enter` `@Down` `@Up` `@Space` `@Tab` `@Escape` |
| `obt-watch` | 每 2 秒输出一行 NDJSON 心跳（含 `model` / `busy` / `agents_waiting` / `current_stage`）；用 Monitor 工具跑它 |
| `obt-stop` | kill tmux，并 dump scrollback 到 `/tmp/xft-comat-test-*-final-*.log` |

### 模型核验与隔离（务必先读）

被测会话默认请求 `sonnet`（`XFT_COMAT_MODEL=haiku|opus|sonnet|<slug>` 覆盖）。但**请求的模型不等于实际跑的模型**：本机已排查无 managed-settings、无 shell/env 钉死、`~/.claude.json` 也无模型选择项，历史测试里 `--model sonnet` 仍被改写成 `deepseek-v4-flash`，说明改写发生在**账号或网关服务端**——`CLAUDE_CONFIG_DIR` 隔离压不住它。

因此 `obt-start` 在发 prompt 前从隔离 home 的 statusLine 解析 `[MODEL:xxx]`，与请求模型比对：

- `model_check=OK` —— 实际与请求一致，正常继续。
- `model_check=MISMATCH` —— **默认拒绝启动并非零退出**（kill 会话），输出 `actual_model=<x>`。这是防止“以为在测 sonnet 实际跑 deepseek”污染结论的唯一闸门。
  - 若该环境只能服务某模型：显式 `XFT_COMAT_MODEL=<actual>` 重跑，核验转 OK，报告如实标注该模型。
  - 确知不符仍要继续（调试）：`XFT_COMAT_ALLOW_MODEL_MISMATCH=1` 放行，输出转 `MISMATCH_ALLOWED`，报告**必须**写 `actual_model`。
- `model_check=UNKNOWN` —— 没解析到 statusLine，无法核验；人工确认后再决定是否继续。

隔离（`CLAUDE_CONFIG_DIR=$SANDBOX/.claude-test-home`）让被测会话脱离用户全局 `~/.claude`：不加载第三方插件（如 security-guidance 的 Stop hook，历史上被误记为工作流“卡死”）、不继承全局 model/statusLine。隔离 home 引发登录/信任异常时，`XFT_COMAT_NO_ISOLATION=1` 可关隔离但仍保留模型核验。

**每轮报告必须引用 `obt-start` 输出的 `actual_model` 与 `model_check`，不得假设。**

## 被测行为模型

一个新需求从 `/pilot <任务>` 进入后，正常应观察到下面链路。

### 1. 公共澄清、路由与初始化

当前目录没有 `.xft-comat` 任务时，pilot command 应先做公共前置阶段：接收任务、轻量探索、用 `grill-idea` skill 做想法澄清（grill 式访谈：一次只问一个问题、附推荐答案、能从代码探索回答的不问用户）。澄清完成后才应执行：

```bash
node "${CLAUDE_PLUGIN_ROOT}/workflow/pilot/scripts/workflowctl.ts" route --task "<澄清后的任务摘要>"
```

读取路由框架后，由模型自行判断 mode，再调用：

```bash
node "${CLAUDE_PLUGIN_ROOT}/workflow/pilot/scripts/workflowctl.ts" init --topic "<topic>" --mode <mode> --summary "<摘要>"
```

注意：`route` 只提供评判框架，不自动定级；如果被测会话声称“脚本判断出了 mode”，这是误读。

反模式：对话一开始先跑 `workflowctl.ts route --task "<用户首条原文>"`，或澄清阶段不用可用的提问工具。

接收/探索/澄清/路由在 `init` 之前由主会话完成，不进入状态机；`init` 后直接落在第一个实质阶段。各 mode 阶段如下（阶段名以 `workflowctl.ts` 的 `MODE_STAGES` 为准；verify 已并入 implement；fix 为条件阶段，review 用 `record-review --blocking false` 登记无阻塞发现时自动跳过）：

| mode | 使用场景 | init 之后的阶段 |
|---|---|---|
| `feature-simple` | 单点低风险新功能，需求清楚 | implement → review → fix* → final-verify → close |
| `feature-medium` | 多文件或有限设计取舍 | plan → implement → review → fix* → final-verify → close |
| `feature-hard` | 高风险、跨模块、安全、权限、UI E2E 或关键架构抉择 | plan → decide → implement → review → fix* → final-verify → close |
| `bugfix` | 错误、异常、失败测试、回归或现有行为不符 | investigate → implement → review → fix* → final-verify → close |
| `refactor` | 行为不变的结构整理、拆分、复用、性能清理 | investigate → plan → implement → review → fix* → final-verify → close |

`decide` 由主会话直接驱动：读取 02-design.md 的待决策点，用 AskUserQuestion 逐个向用户拿到拍板，再用 `record-decision` 写入设计文档开头。

注意：pilot 主会话不应自行枚举这些阶段——它只循环 `next --task-dir <dir>` 拿“分派包”（stage、dispatch.agent 指名的 worker 变体、skill_paths、inputs、outputs_expected、quality_gate、advance_to）。Codex 无 subagent 机制：阶段工作由主会话按分派包装载对应方法论 skill 执行，并以 `--executor main` 加 `--reason`（如 "runtime codex 无 subagent"）自录通过门禁。被测会话若手写阶段计划而不调用 `next`，是反模式。

### 2. 工作流目录维护

`.xft-comat` 只能通过 `workflowctl.ts` 写入或更新。合理行为包括：

- 用 `init` 创建 `YYYY-MM-DD-topic` 任务目录和模板文档。
- 用 `advance` 推进关键阶段（fix 在 `next` 返回 `skip_recommended: true` 时直接 advance 跳过）。
- 用 `submit`（写文档 + 登记阶段执行合一，`--executor` 在 Codex 下为 `main` 且必带 `--reason`）或 `set-doc` 写当前阶段文档。
- review 阶段必须用 `record-review --blocking true|false` 落库审查结论。
- review/fix 阶段必须写入 review 专用文档，不能覆盖 `02-design.md` / `02-design-note.md`；close 后设计文档仍应保留 plan 阶段的方案内容。
- plan 阶段从 `next` 输出的 `available_skills` 筛选 skill，再用 `record-skill` 记录 `required` / `accepted` / `declined` / `skipped`。
- 用 `new-test-round`（首轮在实现阶段懒创建；加 `--if-missing true` 防重复开轮）、`add-test-case`（逐条登记用例）和 `check-test` 维护测试轮次和用例状态。
- 结构化 implementation task 必须用 `set-task --status done --evidence ...` 闭环；`todo` / `doing` / `blocked` 不能通过 `validate` / `close`。
- implement/fix 待办实现任务 ≥ 2 时，`next` 返回 `dispatch.parallel: true`；Codex 无 subagent，按任务逐个顺序执行即可，但仍应逐任务 `submit --append true` 追加小节并 `set-task done`。

工作流主会话的强制纪律（Codex 运行时）：

- `init` 应带 `--runtime codex` 标记无 subagent 运行时。
- 阶段工作按 `next` 分派包装载对应方法论 skill 执行，自录用 `--executor main` 且必带 `--reason`；阶段执行记录（submit / record-stage）仍必须完整，不得静默缺席。
- 主会话经 `workflowctl.ts` 维护 `.xft-comat`，但不得绕过脚本直接写该目录。
- 业务代码和测试变更仍须遵守阶段纪律（测试先行、审查早于最终验证）。

反模式：Codex 直接用 Write/Edit/MultiEdit/apply_patch、shell 重定向、heredoc、`cat >`、脚本生成等方式手动改 `.xft-comat` 或业务文件；脑内推进状态但没真实调用脚本；主会话直接实现业务代码或测试。

### 3. 澄清、设计与用户决策

- 想法澄清（`grill-idea`）应一次只问一个问题、每问附推荐答案、沿决策树按依赖顺序逐个解决，直到向用户复述想法并获确认；优先使用 `AskUserQuestion` 或当前运行时的等价提问工具，能从代码探索回答的不转问用户。
- `feature-simple` 可轻量合并需求、设计、测试计划。
- `feature-medium` 只有存在真实架构取舍时才要求用户确认；否则记录单一推荐方案。
- `feature-hard` 必须保留 plan 阶段的方案和用户关键抉择；plan 阶段（装载 solution-design skill）列决策点，decide 阶段主会话用 AskUserQuestion（或 Codex 等价提问工具）拿拍板并经 `record-decision` 写入 `02-design.md` 开头。
- `bugfix` 先复现和根因，不走新功能架构设计。
- `refactor` 先行为基线和安全网，不改变外部行为。

### 4. worker 变体与 skill 使用

执行模型是「状态机定做什么，skill 定怎么做，worker 只管执行」。插件定义两个通用 worker 变体（指挥/编排由 pilot 主会话承担，无 conductor；skill 筛选内联在 plan 分派包，无 skill-scout）：

- `worker` — 读写变体（implement / fix）。
- `worker-ro` — 只读变体（init 前探索、investigate、plan、review、final-verify）。

Codex 无 subagent 机制，无法真正分派这两个 agent；主会话应按 `next` 分派包 `skill_paths` 指名的方法论 skill（explore-project / investigation / solution-design / task-splitting / domain-modeling / tdd / code-review / e2e-verification）亲自执行，并以 `--executor main --reason "runtime codex 无 subagent"` 自录。判定时关注的是**阶段方法论是否被装载执行、执行记录是否完整**，而不是是否真的起了 subagent。

UI 或浏览器端到端流程必须把 `agent-browser` 记录为 `required`，并在验证阶段实际使用对应 skill。不要为普通纯函数或配置改动套用重型阶段。

### 5. TDD、验证与 close

- 实现阶段默认 TDD：先补或改测试，再实现，再跑验证命令。
- `bugfix` 必须有复现证据、根因和回归测试。
- `refactor` 必须有行为基线、安全网和等价验证。
- 验证失败先记录失败并修复重验；只有测试范围或失败假设变化时才开新 round。
- close 汇报交付结果、验证情况、残余风险和 `.xft-comat/<run>/` 路径。

## 反模式清单（命中即停）

路由层：

- bug 被当 feature；refactor 被当 feature；安全/认证/权限/UI E2E 被降成 simple；单文件纯函数被升成 hard。
- `route` 输出被误认为自动定级，而不是模型自评框架。
- preflight 一次抛出长问题清单，或问不影响落地的问题。
- 对话刚开始就调用 `route --task`，让用户先等待路由而不是先看到澄清问题和探索动作。
- 有可用提问工具却用普通文本做澄清。

目录层：

- 直接写 `.xft-comat`，绕过 `workflowctl.ts`。
- review/fix 产出覆盖设计、复现、根因或重构计划文档，导致上游方案丢失。
- 主会话直接修改业务代码、测试、配置或任意项目文件，绕过阶段纪律（未装载阶段 skill、未先测试后实现）。
- `advance` / `set-doc` / `record-skill` 没跑却声称已记录。
- 结构化任务仍是 `todo` / `doing` / `blocked` 却 close，或 `validate` 未挡住未完成 implementation task。
- 文档模板全部机械填满，写大量”待补充”噪音，而不是按当前任务实际需要记录。

执行层：

- 实现前没有测试计划或测试先行动作。
- `bugfix` 跳过复现和根因，直接改代码。
- `refactor` 改变外部行为或没有安全网。
- UI/E2E 场景没有记录并使用 `agent-browser`。

worker/skill 层：

- 引用不存在的 agent 名称（合法名只有 `worker` / `worker-ro`），或把它们当成 Codex 能真正分派的 subagent。
- 阶段工作没有装载分派包 `skill_paths` 指名的方法论 skill 就直接干；或 review 与 implement 在同一无差别上下文里混做。
- 阶段产出没有自录（不跑 `submit`/`record-stage`/`check-test`），或 `--executor main` 兜底却不带 `--reason`；或绕过 `workflowctl.ts` 直接写 `.xft-comat`。

收束层：

- 验证失败仍 close。
- close 不报告测试结果、残余风险或工作流记录目录。
- sandbox 留下半截 tmux 会话和未 dump 的失败现场。

## 核心测试流程

### 1. 准备 sandbox

```bash
obt-init
obt-reset                      # feature-simple / feature-medium / feature-hard
obt-reset --fixture bugfix     # bugfix 用例：种入带 bug 的 parseDuration.js
obt-reset --fixture refactor   # refactor 用例：种入内联的 cart.js
```

`obt-reset` 是每个 prompt 开始前的动作，不是跑完后自动清理；跑完后保留产物方便用户检查。`bugfix` / `refactor` 必须带对应 `--fixture`，否则被测会话面对空 sandbox 会把“新建文件”合理地判成 feature——这是测试用例的问题，不是插件 bug。

### 2. 选 prompt

读取 `references/test-prompts.md`。验证“所有 workflow/mode”时，一轮至少覆盖：

- `feature-simple`
- `feature-medium`
- `feature-hard`
- `bugfix`
- `refactor`

测试 prompt 只写产品需求或修复/重构目标，不要告诉被测会话“应该选哪个 mode”。mode 必须由 pilot command 根据任务性质自行判断。

### 3. 启动被测会话和心跳

```bash
obt-start "<prompt 原文>"
```

**先看 `obt-start` 输出的 `model_check`**：非零退出或 `model_check=MISMATCH` 时会话已被 kill，不要继续——按上面「模型核验」处置。`model_check=OK` 或 `MISMATCH_ALLOWED` 才往下走，并记下 `actual_model` 备报告引用。

然后用 Monitor 工具运行：

```bash
obt-watch
```

不要用主会话循环 `obt-snap` 轮询；被测会话可能运行 10 分钟以上，Monitor 更省上下文。

### 4. 根据心跳行动

读心跳的新字段，不靠体感判断：

| 心跳信号 | 处理 |
|----------|------|
| `busy:true`（含 `esc to interrupt`） | 模型正在生成，继续监听，**无论 idle 多大都不算卡死** |
| `tail` 出现问题、选项列表、`↑↓` 提示 | 用 `obt-snap` 看完整问题，按 `references/interaction-protocol.md` 应答 |
| `current_stage` 变化 | 工作流在推进，记录阶段轨迹 |
| 命中下方「客观卡死标准」 | 才按卡死处置 |
| `event: session_ended` | `obt-stop` 获取 dump，判断正常退出还是崩溃 |

**客观卡死标准（同时满足才算卡死）**：`busy:false` ∧ `idle_sec >= 120` ∧ 连续 3 拍 `tail`（屏幕）无变化。任一不满足都继续等。

注：`agents_waiting` 字段是 Claude 运行时（有 subagent）的等待信号；Codex 无 subagent，该字段恒为 0，卡死判定主要看 `busy` / `idle_sec`。阶段间若出现长 thinking 但屏幕仍在变化（`busy:true`）不算卡死。

### 5. 应答澄清和决策

读取 `references/interaction-protocol.md`。原则：

- 主 Codex 代用户做合理决策，不跳过关键澄清。
- 不连续多次选择 Recommended；不同 prompt 轮换决策风格。
- 对 `feature-hard`，保留更丰富的设计抉择；对 `feature-simple` / `bugfix`，偏轻量。
- 发完输入后 `obt-snap` 复核是否进入下一步。

**轮询纪律**：`obt-snap` 只在心跳触发时用（出现问题/选项、命中卡死标准、需要留证），不要主会话循环 snap 当心跳——那是 Monitor + `obt-watch` 的活。15 秒内连续 `obt-snap` 超过 3 次即 tester 自身违规（历史上 6 分钟 snap 80 次，既烧上下文又诱发急躁 kill）。

### 6. 判定结果

每个 prompt 落一个三态判定，不允许把没跑完的算成功：

- **PASS** —— 走到 `close`、`validate` 通过、全程无反模式。
- **PARTIAL** —— 任何人为/环境中断（提前 kill、模型核验放行、上下文吃紧等）。报告必须分「已验证 / 未验证」两栏，未验证项逐条列（如 fix-skip、final-verify、validate 门禁、close 汇报）。
- **FAIL** —— 命中反模式或工作流出错。

**硬规则：没有观测到 `close`，禁止使用「通过 / ✅ 通过」字样**——最多是 PARTIAL。历史报告把 review 中途 kill、plan 跑一半 kill 都写成「✅ 通过」，这次不允许。

到达 close 的，逐项核对：

- 实际 mode 是否符合预期；如果不符合，理由是否充分。
- `.xft-comat/<run>/workflow.json` 的 stage 是否推进合理。
- 关键文档是否存在且内容真实：routing、requirements、design/design-note、review、test-cases、state、tasks、skill-usage。
- `02-design.md` / `02-design-note.md` 在 close 后是否仍保留设计方案，review 内容是否写入 review 专用文档。
- `workflow.json.tasks` 与 tasks 文档中的 implementation task 是否都已 `done`，且 `validate` 能挡住未完成任务。
- 是否通过 `workflowctl.ts` 维护目录，而不是直接写文件。
- 测试和验证是否真实运行，失败是否被记录和处理。
- 阶段 skill 装载与自录是否完整、`--executor main --reason` 是否留痕。

命中反模式（FAIL）时立即：

```bash
obt-stop
```

报告 dump 路径、命中的反模式、相关 scrollback、疑似根因。若用户要求修复插件，则改 `commands/pilot.md`、`workflow/pilot/`、`agents/`、`skills/` 或 `workflowctl.ts`，再 `obt-reset` 并用同一 prompt 重跑。

### 7. 单 prompt 报告格式

每个 prompt 的报告**必填以下字段，缺任一字段即报告不合格**：

- **判定**：PASS / PARTIAL / FAIL（遵守「无 close 不写通过」）。
- **actual_model + model_check**：取自 `obt-start` 输出，不得假设（历史报告全程没提实际跑的是 deepseek）。
- prompt 摘要、预期 mode、实际 mode；fixture（如有，如 `--fixture bugfix`）。
- 最深到达的 stage；是否到 `close`；`validate` 输出。
- 澄清轮次：是否一次一问、是否只问阻塞问题、是否走了提问工具（非纯文本）。
- workflowctl 命令链是否完整：route / init / advance / next / set-doc / submit / skills list / record-skill / record-stage / check-test。
- skill 装载：各阶段是否装载了对应方法论 skill（explore-project / investigation / solution-design / tdd / code-review / e2e-verification）、阶段执行记录与 `--executor main --reason` 留痕是否完整。
- 测试结果：命令、PASS/FAIL、测试轮次。
- **未覆盖清单**：本轮没观测到的环节（如 decide / fix-skip / final-verify / close 门禁），PARTIAL 必列。
- 中断原因与时间线（PARTIAL/FAIL 必填）。
- 产出文件、残余风险、dump + pipe 路径。

不要自动 `obt-reset`；等用户确认继续下一轮再重置。

## 中断处理

| 状况 | 处置 |
|------|------|
| `obt-start` 非零退出 / `model_check=MISMATCH` | 模型被服务端改写；显式 `XFT_COMAT_MODEL=<actual_model>` 重跑，或确知后 `XFT_COMAT_ALLOW_MODEL_MISMATCH=1` 放行并标注 |
| tmux session 退出 | `obt-stop` 看 dump，搜 `Error` / `Traceback` / `panic` / `permission` |
| Codex 起不来或卡 trust | 隔离 home 已预接受 onboarding/trust；仍卡则 `XFT_COMAT_NO_ISOLATION=1` 回退非隔离，或检查 keychain 登录态 |
| 澄清或 AskUserQuestion 节奏对不上 | 先 `obt-snap` 看焦点；必要时 `@Escape` 或 `obt-stop` 重来 |
| `workflowctl.ts` 报错 | 插件 bug 或测试脚本 cwd/env 错；抓命令和错误输出后定位 |
| 工作流目录不符合预期 | 判断是 pilot command 违规、脚本 bug，还是 prompt 不适合作为该 mode 用例 |
| 主会话上下文吃紧 | `obt-stop`，把已跑 prompt、结论和 dump 路径写到 sandbox 根 `TEST-LOG.md` |

## 首次自检

第一次改完 tester skill 后：

1. `obt-init` 创建 sandbox 和隔离 `.claude-test-home`。
2. `obt-reset` 确认可回到 baseline；`obt-reset --fixture bugfix` 确认能种入 fixture 且 `node --test` 现状全绿。
3. 用 `feature-simple` 的 normalizeTags prompt 跑一轮 `obt-start`，确认 `model_check` 与 `actual_model` 符合预期（不符按「模型核验」处置）。
4. 用 Monitor 监听 `obt-watch`，确认 NDJSON 心跳含 `model` / `busy` / `agents_waiting` / `current_stage` 字段。
5. 交互完成后检查 `.xft-comat` 记录和 `obt-stop` dump。

通路问题先修 `.agents/skills/plugin-tester/scripts/`；行为问题再修 `xft-comat` 插件本体。
