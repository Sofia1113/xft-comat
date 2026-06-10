# xft-comat

Claude Code / Codex 插件：把 **xft-comat 工作流** —— 一套轻量、程序驱动的 AI Coding 工作流 —— 打包成可安装、可分发、可版本化的插件。

适用于需要受控执行的非平凡任务：新功能、bug 修复、重构。提供智能路由（按复杂度分级）、专职 subagent 团队、TDD、E2E 验证，并把可追踪记录持久化到用户项目的 `.xft-comat` 目录。

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
├── skills/                        # 方法论 skill；前两个由主会话调用，
│   │                              # 其余由各阶段 agent 按 next 返回的路径 Read
│   ├── requirements-clarifier/    # 需求澄清（主会话，路由前，优先 AskUserQuestion）
│   ├── workflow-router/           # 路由判定（主会话，init 之前）
│   ├── domain-modeling/           # DDD 领域建模（plan 阶段 → architect）
│   ├── tdd/                       # 测试先行实现（implement/fix → tdd-engineer）
│   ├── code-review/               # 代码审查（review → code-reviewer）
│   ├── e2e-verification/          # 端到端验证（final-verify → e2e-verifier）
│   └── agent-browser/             # 固定浏览器能力 skill
├── hooks/
│   ├── hooks.json                 # PreToolUse：拦截对 .xft-comat 的直接写入
│   └── guard-xft-dir.mjs          # （仅 Claude Code 生效；Codex 无 hook 机制）
├── workflow/
│   └── pilot/
│       ├── scripts/workflowctl.ts # 唯一的 .xft-comat 写入入口
│       └── templates/             # 各阶段文档模板（哨兵占位 <!-- XFT-TODO -->）
└── agents/                        # 7 个专职 subagent，安装后自动加载
    │                              # 文件名不带前缀；agent 名由各文件 frontmatter
    ├── project-explorer.md        # → project-explorer
    ├── architect.md               # → architect
    ├── tdd-engineer.md            # → tdd-engineer
    ├── bug-diagnostician.md       # → bug-diagnostician
    ├── refactor-specialist.md     # → refactor-specialist
    ├── e2e-verifier.md            # → e2e-verifier
    └── code-reviewer.md           # → code-reviewer
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

- 主入口是 `/pilot` command。它只做四件事：项目探索 → 需求澄清（`requirements-clarifier` skill，优先 AskUserQuestion）→ 路由（`workflow-router` skill）+ init → 循环调用 `workflowctl.ts next` 获取下一阶段的 agent 与输入并分派，直到流程结束。pilot 不需要知道路由之后有哪些阶段，pilot 本身就是工作流的指挥者。
- 需求澄清由 `requirements-clarifier` skill 承担，采用逐轮追问方式；能从代码探索回答的问题不转问用户。
- 项目现状探索优先使用内置 `project-explorer` agent；不可用时由主会话做只读 fallback，并记录原因。
- 7 个专职 agent 随插件文件一起分发，按运行时支持的 agent 发现机制加载；工作流阶段应最小必要地分派。
- 工作流目录写入用户**当前项目**的 `.xft-comat/`（不是插件目录）；脚本通过自身路径定位模板，与当前工作目录无关。
- **运行时差异**：多 agent 深度协作的保证（hard 的 architect/tdd-engineer/code-reviewer 参与门禁）只在支持 subagent 的运行时（Claude Code）完整成立；Codex 下用 `init --runtime codex` 标记，专职 agent 可记 skipped + runtime 原因，工作仍按阶段执行并留同等文档痕迹。

详见 [`commands/pilot.md`](commands/pilot.md) 与 [`workflow/pilot/scripts/README.md`](workflow/pilot/scripts/README.md)。

项目级用户需求与流程质量要求见 [`docs/requirements.md`](docs/requirements.md)。

## 设计要点

- `.xft-comat` 目录只能通过 `scripts/workflowctl.ts` 维护，不手动编辑；Claude Code 下由插件 PreToolUse hook 程序强制拦截直接写入。
- 工作流主会话不得直接修改任何项目文件、代码、测试或配置；主会话只负责编排、澄清、路由、分派和核验证据。主会话经脚本写入的文档只有：路由引导的 `00-routing.md` / `01-requirements.md`，以及 decide 阶段的 `record-decision`（用户拍板结论，写入设计文档开头——用户交互产物没有 agent 能代劳）。其余阶段文档与证据由被分派的 agent 自己调用 `workflowctl.ts`（优先 `submit` = 写文档 + 登记参与合一）写回。业务代码和测试变更必须交给专职 agent 或明确的外部 skill。
- 澄清先行、路由后置：接收/探索/澄清/路由在 `init` 之前由主会话完成，不进入状态机（留痕在路由两文档）；`init` 后直接落在第一个实质阶段。审查统一落在 `review`，最终验证/E2E/等价验证统一落在 `final-verify`，`review` 必须早于 `final-verify`（程序门禁）。
- 阶段按复杂度真正分层：`feature-simple` implement→review→fix→final-verify→close；`feature-medium` 前加 plan；`feature-hard` plan→decide→implement→…（先有方案比较，用户在 decide 拍板，主会话用 AskUserQuestion 交互）；`bugfix` 以 investigate 开头；`refactor` investigate→plan→…。verify 并入 implement（实现 agent 自带基础验证）；fix 是条件阶段，review 用 `record-review --blocking false` 登记无阻塞发现时自动跳过。
- 阶段推进由 `workflowctl.ts next --task-dir <dir>` 驱动：返回当前阶段的"分派包"（agent、方法论 skill 路径、**输入白名单文档**、输出契约、质量门禁、`advance_to`），pilot 据此分派并推进，无需枚举阶段。plan 阶段分派包内联 `available_skills`，optional skill 由主会话向用户确认（不再单独分派侦察 agent）。
- 原子阶段统一：5 种 workflow 只拼接 `workflowctl.ts` 内置的通用阶段，不因不同模式为同一语义另造阶段名。
- 轻量上下文与最小仪式：每个阶段只下发输入契约对应的文档（程序保证，非靠自觉）；agent 用 `submit` 一次完成产出落库与参与登记；门禁只保留机器可核验项（占位哨兵、阶段遍历、review/fix 闭环、测试勾选闭环、任务 owner），不要求书写表演性"证据"文本。
- close 出口与阶段守卫共享同一套事实：所有实质阶段 completed/skipped 才能 close，advance 不可跳过 pending 阶段（条件 fix 除外）。
