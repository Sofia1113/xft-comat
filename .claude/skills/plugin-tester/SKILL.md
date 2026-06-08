---
name: plugin-tester
version: 0.3.0
description: 端到端测试 xft-comat 工作流插件（/xft-comat:pilot + workflowctl.py + specialist agents）。在 tmux 里启动隔离的 Claude Code 子会话、通过 --plugin-dir 加载当前 xft-comat 插件、用预置 prompt 覆盖 feature-simple / feature-medium / feature-hard / bugfix / refactor 五种工作流，实时监控会话、模拟澄清和设计决策、检查 .xft-comat 是否只由 workflowctl.py 维护、判断路由、TDD、agent 分派、skill 记录和验证闭环是否合理。用户说“测试 xft-comat 插件”“跑工作流插件 E2E”“验证 xft-comat workflow”“重跑插件回归”“验证所有 workflow/mode”时使用。
---

# xft-comat Plugin Tester

测 `xft-comat` 插件本身的端到端行为。这个 skill 不是用 `xft-comat` 来开发业务需求，而是把 `xft-comat` 当被测系统，在隔离 sandbox 里跑真实 Claude Code 子会话，观察它是否按插件约定推进工作流。

权威来源按优先级读取：

1. `.claude-plugin/plugin.json` — 插件身份和分发信息。
2. `skills/pilot/SKILL.md` — 主 workflow skill 的行为契约。
3. `skills/pilot/scripts/workflowctl.py` — `.xft-comat` 的唯一写入口和命令契约。
4. `agents/*.md` — specialist agent 名称与职责。
5. 本 skill 的 `references/` — 测试视角的 prompt 清单和 tmux 交互协议。

如果本文件与插件源码不一致，以插件源码为准，并回头修这个 tester skill。

## 何时使用

用户要求以下任一事项时使用：

- “测试 xft-comat 插件” / “跑工作流插件回归” / “验证所有 workflow/mode”。
- “改了 `pilot`（主 skill）/ `workflowctl.py` / agents 之后跑一遍看看”。
- “重跑那个 bugfix/feature-hard/refactor 场景”。

不使用这个 skill 的情况：

- 用户只是想用 `xft-comat` 完成某个真实项目任务 → 调用 `/xft-comat:pilot`。
- 用户只问插件设计或代码结构 → 直接读 `skills/pilot/`、`agents/` 和脚本回答。

## 固定路径

| 路径 | 用途 |
|------|------|
| `~/WorkSpace/xft-comat` | 默认被测插件源码（`XFT_COMAT_PLUGIN`） |
| `~/WorkSpace/xft-comat-sandbox` | 默认测试 sandbox（`XFT_COMAT_SANDBOX`），首次跑 `obt-init` 创建 |
| `.claude/skills/plugin-tester/scripts/obt-*` | 测试脚本，名称沿用 `obt-*` 以兼容旧调用 |
| `.claude/skills/plugin-tester/references/` | 测试 prompt 清单和 tmux 交互协议 |
| `/tmp/xft-comat-test-<session>.log` | tmux pipe-pane 全量日志，Monitor 监听它 |

脚本默认会从自身位置推导当前插件根；环境不同可显式传 env：

```bash
XFT_COMAT_PLUGIN=/Users/sofia/WorkSpace/xft-comat \
XFT_COMAT_SANDBOX=/Users/sofia/WorkSpace/xft-comat-sandbox \
.claude/skills/plugin-tester/scripts/obt-start "<prompt>"
```

## 工具脚本速查

| 命令 | 作用 |
|------|------|
| `obt-init` | 首次创建空壳 sandbox（git init + 最小 Node 项目 + baseline commit） |
| `obt-reset` | sandbox `git reset --hard` 到 baseline + `git clean -fdx`，清掉 `.xft-comat/` 和产物；每次重跑前必跑 |
| `obt-start "<prompt>"` | 起 tmux 会话、`--plugin-dir` 加载插件、发送 `${XFT_COMAT_ENTRYPOINT:-/xft-comat:pilot} <prompt>` |
| `obt-snap [N]` | 抓当前 tmux 屏幕末 N 行（默认 200） |
| `obt-send <text\|@key> ...` | 给 tmux 发输入；支持 `@Enter` `@Down` `@Up` `@Space` `@Tab` `@Escape` |
| `obt-watch` | 每 2 秒输出一行 NDJSON 心跳；用 Monitor 工具跑它 |
| `obt-stop` | kill tmux，并 dump scrollback 到 `/tmp/xft-comat-test-*-final-*.log` |

被测会话默认 `sonnet`，更接近真实工作流判断质量；需要省 token 或复现特定问题时用 `XFT_COMAT_MODEL=haiku|opus|sonnet` 覆盖。

## 被测行为模型

一个新需求从 `/xft-comat:pilot <任务>` 进入后，正常应观察到下面链路。

### 1. 路由与初始化

当前目录没有 `.xft-comat` 任务时，workflow skill 应先用：

```bash
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" route --task "<用户任务>"
```

读取路由框架后，由模型自行判断 mode，再调用：

```bash
python "${CLAUDE_PLUGIN_ROOT}/skills/pilot/scripts/workflowctl.py" init --topic "<topic>" --mode <mode> --summary "<摘要>"
```

注意：`route` 只提供评判框架，不自动定级；如果被测会话声称“脚本判断出了 mode”，这是误读。

| mode | 使用场景 | 阶段重点 |
|---|---|---|
| `feature-simple` | 单点低风险新功能，需求清楚 | clarify-lite → plan → implement → verify → review → close |
| `feature-medium` | 多文件或有限设计取舍 | clarify-design → user-confirm-if-needed → implement → verify → review → close |
| `feature-hard` | 高风险、跨模块、安全、权限、UI E2E 或关键架构抉择 | clarify → architect-options → user-decision → implement → e2e-verify → review → close |
| `bugfix` | 错误、异常、失败测试、回归或现有行为不符 | reproduce-root-cause → fix-plan → implement-regression → verify → review → close |
| `refactor` | 行为不变的结构整理、拆分、复用、性能清理 | baseline-plan → safety-refactor → verify-equivalence → review → close |

### 2. 工作流目录维护

`.xft-comat` 只能通过 `workflowctl.py` 写入或更新。合理行为包括：

- 用 `init` 创建 `YYYY-MM-DD-topic` 任务目录和模板文档。
- 用 `advance` 推进关键阶段。
- 用 `set-doc --content|--stdin|--from-file` 写当前阶段文档。
- 用 `skills list` 获取真实可用 skill 目录，再用 `record-skill` 记录 `required` / `accepted` / `declined` / `skipped`。
- 用 `new-test-round` 和 `check-test` 维护测试轮次和用例状态。

反模式：Claude 直接用 Write/Edit 手动改 `.xft-comat`，或脑内推进状态但没真实调用脚本。

### 3. 澄清、设计与用户决策

- 需求澄清应逐轮追问，每轮 1-3 个真正阻塞落地的问题。
- `feature-simple` 可轻量合并需求、设计、测试计划。
- `feature-medium` 只有存在真实架构取舍时才要求用户确认；否则记录单一推荐方案。
- `feature-hard` 必须保留 architect 方案和用户关键抉择；`02-design.md` 开头写入最终抉择。
- `bugfix` 先复现和根因，不走新功能架构设计。
- `refactor` 先行为基线和安全网，不改变外部行为。

### 4. agent 与 skill 使用

被测会话应优先最小分派：简单判断由主 Claude 完成，只有当前阶段有独立判断价值才派 specialist。

合法 agent 名称：

- `xft-comat-conductor`
- `xft-comat-requirements-interrogator`
- `xft-comat-architect`
- `xft-comat-tdd-engineer`
- `xft-comat-bug-diagnostician`
- `xft-comat-refactor-specialist`
- `xft-comat-e2e-verifier`
- `xft-comat-code-reviewer`
- `xft-comat-skill-scout`

UI 或浏览器端到端流程必须把 `agent-browser` 记录为 `required`，并在验证阶段实际使用对应 skill。不要为了普通纯函数或配置改动过度分派 agent。

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

目录层：

- 直接写 `.xft-comat`，绕过 `workflowctl.py`。
- `advance` / `set-doc` / `record-skill` 没跑却声称已记录。
- 文档模板全部机械填满，写大量“待补充”噪音，而不是按当前任务实际需要记录。

执行层：

- 实现前没有测试计划或测试先行动作。
- `bugfix` 跳过复现和根因，直接改代码。
- `refactor` 改变外部行为或没有安全网。
- UI/E2E 场景没有记录并使用 `agent-browser`。

agent 层：

- 使用不存在或未带 `xft-comat-` 前缀的 agent 名称。
- 简单任务分派多个 specialist；bugfix 同时派 architect；refactor 走新功能架构流程。
- agent 被要求维护 `.xft-comat`，而不是只输出职责范围内的短结构化结果。

收束层：

- 验证失败仍 close。
- close 不报告测试结果、残余风险或工作流记录目录。
- sandbox 留下半截 tmux 会话和未 dump 的失败现场。

## 核心测试流程

### 1. 准备 sandbox

```bash
obt-init
obt-reset
```

`obt-reset` 是每个 prompt 开始前的动作，不是跑完后自动清理；跑完后保留产物方便用户检查。

### 2. 选 prompt

读取 `references/test-prompts.md`。验证“所有 workflow/mode”时，一轮至少覆盖：

- `feature-simple`
- `feature-medium`
- `feature-hard`
- `bugfix`
- `refactor`

测试 prompt 只写产品需求或修复/重构目标，不要告诉被测会话“应该选哪个 mode”。mode 必须由 workflow skill 根据任务性质自行判断。

### 3. 启动被测会话和心跳

```bash
obt-start "<prompt 原文>"
```

然后用 Monitor 工具运行：

```bash
obt-watch
```

不要用主会话循环 `obt-snap` 轮询；被测会话可能运行 10 分钟以上，Monitor 更省上下文。

### 4. 根据心跳行动

| 心跳信号 | 处理 |
|----------|------|
| `tail` 出现问题、选项列表、`↑↓` 提示 | 用 `obt-snap` 看完整问题，按 `references/interaction-protocol.md` 应答 |
| `idle_sec > 30` 且无 `esc to interrupt` | 可能等用户输入或卡住；`obt-snap` 判断 |
| 出现 `完成` / `交付` / `close` / `Done` 且 idle > 20 | 进入结果判定 |
| `event: session_ended` | `obt-stop` 获取 dump，判断正常退出还是崩溃 |
| tail 持续变化且含 `esc to interrupt` | Claude 仍在执行，继续监听 |

### 5. 应答澄清和决策

读取 `references/interaction-protocol.md`。原则：

- 主 Claude 代用户做合理决策，不跳过关键澄清。
- 不连续多次选择 Recommended；不同 prompt 轮换决策风格。
- 对 `feature-hard`，保留更丰富的设计抉择；对 `feature-simple` / `bugfix`，偏轻量。
- 发完输入后 `obt-snap` 复核是否进入下一步。

### 6. 判定结果

跑完一个 prompt 后检查：

- 实际 mode 是否符合预期；如果不符合，理由是否充分。
- `.xft-comat/<run>/workflow.json` 的 stage 是否推进合理。
- 关键文档是否存在且内容真实：routing、requirements、design/design-note、test-cases、state、tasks、skill-usage。
- 是否通过 `workflowctl.py` 维护目录，而不是直接写文件。
- 测试和验证是否真实运行，失败是否被记录和处理。
- agent 使用是否最小、命名是否正确、职责是否干净。

命中反模式时立即：

```bash
obt-stop
```

报告 dump 路径、命中的反模式、相关 scrollback、疑似根因。若用户要求修复插件，则改 `skills/pilot/`、`agents/` 或 `workflowctl.py`，再 `obt-reset` 并用同一 prompt 重跑。

### 7. 单 prompt 报告格式

跑通无反模式时简短报告：

- prompt 摘要、预期 mode、实际 mode、一句话判定。
- 澄清轮次和是否只问阻塞问题。
- workflowctl 命令链是否完整：route / init / advance / set-doc / skills list / record-skill / check-test。
- 关键文档路径：`.xft-comat/<run>/...`。
- agent 使用：用了哪些 specialist，是否最小必要。
- 测试结果：命令、PASS/FAIL、测试轮次。
- 产出文件和残余风险。

不要自动 `obt-reset`；等用户确认继续下一轮再重置。

## 中断处理

| 状况 | 处置 |
|------|------|
| tmux session 退出 | `obt-stop` 看 dump，搜 `Error` / `Traceback` / `panic` / `permission` |
| Claude Code 起不来或卡 trust | `obt-start` 已用 bypass permissions；仍卡则检查 sandbox 的 Claude 项目记录 |
| 澄清或 AskUserQuestion 节奏对不上 | 先 `obt-snap` 看焦点；必要时 `@Escape` 或 `obt-stop` 重来 |
| `workflowctl.py` 报错 | 插件 bug 或测试脚本 cwd/env 错；抓命令和 traceback 后定位 |
| 工作流目录不符合预期 | 判断是 workflow skill 违规、脚本 bug，还是 prompt 不适合作为该 mode 用例 |
| 主会话上下文吃紧 | `obt-stop`，把已跑 prompt、结论和 dump 路径写到 sandbox 根 `TEST-LOG.md` |

## 首次自检

第一次改完 tester skill 后：

1. `obt-init` 创建 sandbox。
2. `obt-reset` 确认可回到 baseline。
3. 用 `feature-simple` 的 slugify prompt 跑一轮 `obt-start`。
4. 用 Monitor 监听 `obt-watch`，确认 NDJSON 心跳正常。
5. 交互完成后检查 `.xft-comat` 记录和 `obt-stop` dump。

通路问题先修 `.claude/skills/plugin-tester/scripts/`；行为问题再修 `xft-comat` 插件本体。
