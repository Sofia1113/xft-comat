# xft-comat

Claude Code / Codex 插件：把 **xft-comat 工作流** —— 一套轻量、程序驱动的 AI Coding 工作流 —— 打包成可安装、可分发、可版本化的插件。

适用于需要受控执行的非平凡任务：新功能、bug 修复、重构。提供智能路由（按复杂度分级）、通用执行 worker + 专业方法论 skill、TDD、E2E 验证，并把可追踪记录持久化到用户项目的 `.xft-comat` 目录。

执行模型：**状态机定做什么，skill 定怎么做，worker 只管执行**——`workflowctl.ts` 状态机决定阶段序列与分派，每个阶段的专业能力收敛在对应 SKILL.md，通用 worker（读写/只读两个变体）装载阶段 skill 后干活并自录证据。

## 插件结构

```
xft-comat/                         # 插件根
├── .codex-plugin/
│   └── plugin.json                # Codex 插件清单（name: xft-comat）
├── .claude-plugin/
│   └── plugin.json                # 插件清单（name: xft-comat）
├── scripts/
│   └── install-codex-offline.mjs  # Codex 本地离线安装器
├── commands/
│   └── pilot.md                   # 主命令：/pilot
├── skills/                        # 方法论 skill：阶段专业能力的唯一归属
│   │                              # （grill-idea / workflow-router 由主会话调用，
│   │                              #  其余由 worker 按 next 返回的绝对路径 Read）
│   ├── grill-idea/                # 想法澄清（grill 式访谈，主会话，路由前，优先 AskUserQuestion）
│   ├── workflow-router/           # 路由判定（主会话，init 之前）
│   ├── explore-project/           # 只读项目探索（init 之前 → worker-ro）
│   ├── investigation/             # bug 复现/根因 + 重构行为基线（investigate → worker-ro）
│   ├── solution-design/           # 方案设计与取舍（plan → worker-ro）
│   ├── task-splitting/            # 任务拆分（plan → worker-ro；并发实现的粒度纪律）
│   ├── domain-modeling/           # DDD 领域建模（plan，业务复杂时配合 solution-design）
│   ├── tdd/                       # 测试先行实现（implement/fix → worker）
│   ├── code-review/               # 代码审查（review → worker-ro）
│   ├── e2e-verification/          # 端到端验证（final-verify → worker-ro）
│   └── agent-browser/             # 固定浏览器能力 skill
├── hooks/
│   ├── hooks.json                 # PreToolUse：拦截对 .xft-comat 的直接写入
│   └── guard-xft-dir.mjs          # （仅 Claude Code 生效；Codex 无 hook 机制）
├── workflow/
│   └── pilot/
│       ├── scripts/workflowctl.ts # 唯一的 .xft-comat 写入入口
│       └── templates/             # 各阶段文档模板（哨兵占位 <!-- XFT-TODO -->）
└── agents/                        # 2 个通用执行 subagent（无领域角色，只有执行协议）
    ├── worker.md                  # → worker：读写变体（implement/fix）
    └── worker-ro.md               # → worker-ro：只读变体（探索/investigate/plan/review/final-verify）
```

## 安装与使用

### Codex 离线安装

本仓库自带 Node 离线安装器，不需要 npm install，也不需要联网：

```bash
node scripts/install-codex-offline.mjs
```

安装器会：

1. 把当前插件复制到本机 Codex 离线 marketplace：`${CODEX_HOME:-~/.codex}/offline-marketplaces/xft-comat/plugins/xft-comat`。
2. 生成本地 marketplace：`${CODEX_HOME:-~/.codex}/offline-marketplaces/xft-comat/.agents/plugins/marketplace.json`。
3. 执行：

```bash
codex plugin marketplace add "${CODEX_HOME:-$HOME/.codex}/offline-marketplaces/xft-comat"
codex plugin add xft-comat@xft-comat-local
```

可先预览：

```bash
node scripts/install-codex-offline.mjs --dry-run
```

如果只想生成离线 marketplace，不立即调用 Codex CLI：

```bash
node scripts/install-codex-offline.mjs --skip-codex-add
```

安装后请新开一个 Codex thread，让 Codex 重新加载插件和 skill。

### 本地开发 / 试用

直接用 `--plugin-dir` 加载本目录：

```bash
claude --plugin-dir /Users/sofia/WorkSpace/xft-comat
```

启动后在会话内运行 `/reload-plugins` 可热加载改动。

### Claude 通过 marketplace 安装

把本仓库加入某个 marketplace 的 `marketplace.json` 后，用户即可：

```text
/plugin marketplace add <your-marketplace-repo>
/plugin install xft-comat@<marketplace-name>
```

### 验证

```bash
claude plugin validate /Users/sofia/WorkSpace/xft-comat
python3 /Users/sofia/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/sofia/WorkSpace/xft-comat
```

## 用法

安装并启用后：

- 主入口是 `/pilot` command。它只做四件事：项目探索 → 想法澄清（`grill-idea` skill，优先 AskUserQuestion）→ 路由（`workflow-router` skill）+ init → 循环调用 `workflowctl.ts next` 获取下一阶段该分派的 worker 变体并分派，直到流程结束。pilot 不需要知道路由之后有哪些阶段，pilot 本身就是工作流的指挥者。
- 想法澄清由 `grill-idea` skill 承担（源自 grill-me 模式，替代清单式需求澄清）：一次只问一个问题、每问附推荐答案、沿决策树按依赖顺序逐个解决，直到能向用户复述其想法并获确认；能从代码探索回答的问题不转问用户。
- 项目现状探索由 `worker-ro` 装载 `explore-project` skill 完成；分派不可用时由主会话按同一 skill 做只读 fallback，并记录原因。
- 仅 2 个通用 subagent（`worker` 读写 / `worker-ro` 只读）随插件分发：worker 文件只含执行协议（取分派包 → Read 阶段 skill → 干活 → 自录 → 汇报），不含任何领域设定；新增/调整阶段能力只需改 `workflowctl.ts` 与对应 SKILL.md，不动 agent。
- 被分派的 worker **自己跑 `next`（只读）取完整分派包**，消除主会话转述丢字段；`advance`/`close` 只归 pilot 主会话，worker 不推进状态机。
- 工作流目录写入用户**当前项目**的 `.xft-comat/`（不是插件目录）；脚本通过自身路径定位模板，与当前工作目录无关。
- **运行时差异**：worker 隔离执行的保证（hard 的 plan/implement/review 阶段执行记录门禁）只在支持 subagent 的运行时（Claude Code）完整成立；Codex 下用 `init --runtime codex` 标记，阶段可由主会话以 `--executor main` + reason 自录通过门禁，工作仍按阶段执行并留同等文档痕迹。

详见 [`commands/pilot.md`](commands/pilot.md) 与 [`workflow/pilot/scripts/README.md`](workflow/pilot/scripts/README.md)。

项目级用户需求与流程质量要求见 [`docs/requirements.md`](docs/requirements.md)。

## 设计要点

- **三层分工**：`workflowctl.ts` 状态机拥有"做什么"（阶段序列、分派、门禁、记录协议），SKILL.md 拥有"怎么做"（各阶段专业方法论），worker 只拥有执行协议（取分派包 → Read skill → 干活 → 自录 → 汇报）。新增阶段能力只改脚本 + skill，零 agent 改动。
- **证据键 = 阶段 + 执行者**：每个实质阶段一条结构化执行记录（`submit` 自动登记，或 `record-stage` 显式登记）：participated 必带证据、skipped 必带原因、`--executor main`（主会话兜底）必带原因——顶替必须显式留痕，不可静默。feature-hard 强制 plan/implement/review 三个阶段有执行记录；UI 任务强制 final-verify 有带证据的执行记录 + agent-browser/frontend-design 决策。
- **工具级权限隔离**：`worker-ro`（探索/investigate/plan/review/final-verify）没有 Edit/Write 工具——"审查者不顺手改代码、设计者不写实现"是工具层硬保证，不只是 prompt 约束。
- `.xft-comat` 目录只能通过 `scripts/workflowctl.ts` 维护，不手动编辑；Claude Code 下由插件 PreToolUse hook 程序强制拦截直接写入。
- 工作流主会话不得直接修改任何项目文件、代码、测试或配置；主会话只负责编排、澄清、路由、分派和核验证据。主会话经脚本写入的文档只有：路由引导的 `00-routing.md` / `01-requirements.md`，以及 decide 阶段的 `record-decision`（用户拍板结论，写入设计文档开头——用户交互产物没有 worker 能代劳）。其余阶段文档与证据由被分派的 worker 自己调用 `workflowctl.ts`（优先 `submit` = 写文档 + 登记执行合一）写回。业务代码和测试变更必须交给 worker 或明确的外部 skill。
- 澄清先行、路由后置：接收/探索/澄清/路由在 `init` 之前由主会话完成，不进入状态机（留痕在路由两文档）；`init` 后直接落在第一个实质阶段。审查统一落在 `review`，最终验证/E2E/等价验证统一落在 `final-verify`，`review` 必须早于 `final-verify`（程序门禁）。
- 阶段按复杂度真正分层：`feature-simple` implement→review→fix→final-verify→close；`feature-medium` 前加 plan；`feature-hard` plan→decide→implement→…（先有方案比较，用户在 decide 拍板，主会话用 AskUserQuestion 交互）；`bugfix` 以 investigate 开头；`refactor` investigate→plan→…。verify 并入 implement（实现 worker 自带基础验证）；fix 是条件阶段，review 用 `record-review --blocking false` 登记无阻塞发现时自动跳过。
- 阶段推进由 `workflowctl.ts next --task-dir <dir>` 驱动：返回当前阶段的"分派包"（worker 变体、方法论 skill 路径、**输入白名单文档**、输出契约、质量门禁、`advance_to`）。`next` 只读，**worker 自己跑 next 取分派包**（消除主会话转述丢字段）；`advance`/`close` 只归 pilot。plan 阶段分派包内联 `available_skills`，optional skill 由主会话向用户确认（不再单独分派侦察 agent）。
- **小任务并发实现**：plan 按 `task-splitting` skill 把实现任务拆成「一个测试点 + 最小实现」的独立任务——**文件范围互不相交是硬约束**（重叠用 `--deps` 串联），时长只是参考，内聚单元不为凑粒度切碎；implement/fix 的分派包附 `inputs.pending_tasks`，待办 ≥ 2 时 `dispatch.parallel: true`——pilot 按依赖分波，同一波内每个任务并发分派一个独立 worker，避免单 worker 抱着大任务长跑。写类子命令带任务目录写锁，并发 worker 用 `submit --append true` 追加小节、`add-test-case` 逐条登记用例、`new-test-round --if-missing true` 防重复开轮，互不覆盖。
- 原子阶段统一：5 种 workflow 只拼接 `workflowctl.ts` 内置的通用阶段，不因不同模式为同一语义另造阶段名。
- 轻量上下文与最小仪式：每个阶段只下发输入契约对应的文档（程序保证，非靠自觉）；worker 用 `submit` 一次完成产出落库与执行登记；门禁只保留机器可核验项（占位哨兵、阶段遍历、review/fix 闭环、测试勾选闭环、任务 owner），不要求书写表演性"证据"文本。
- close 出口与阶段守卫共享同一套事实：所有实质阶段 completed/skipped 才能 close，advance 不可跳过 pending 阶段（条件 fix 除外）。
