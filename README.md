# xft-comat

Claude Code / Codex 插件：把 **xft-comat Workflow** —— 一套轻量、程序驱动的 AI Coding 工作流 —— 打包成可安装、可分发、可版本化的插件。

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
├── skills/
│   └── pilot/                     # 主 skill：/xft-comat:pilot
│       ├── SKILL.md
│       ├── scripts/workflowctl.ts # 唯一的 .xft-comat 写入入口
│       ├── templates/             # 各阶段文档模板
│       └── evals/evals.json       # skill 评测用例
└── agents/                        # 8 个专职 subagent，安装后自动加载
    │                              # 文件名不带前缀；agent 名由各文件 frontmatter
    ├── conductor.md               # → conductor
    ├── architect.md               # → architect
    ├── tdd-engineer.md            # → tdd-engineer
    ├── bug-diagnostician.md       # → bug-diagnostician
    ├── refactor-specialist.md     # → refactor-specialist
    ├── e2e-verifier.md            # → e2e-verifier
    ├── code-reviewer.md           # → code-reviewer
    └── skill-scout.md             # → skill-scout
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

- Codex 中主 skill 名为 `xft-comat:pilot`，可通过插件或 skill 选择器显式调用，也会在合适的任务上下文中被模型选择。
- Claude 中主 skill 调用名为 `/xft-comat:pilot`。
- 9 个专职 agent 随插件文件一起分发，按运行时支持的 agent 发现机制加载；工作流阶段应最小必要地分派。
- 工作流目录写入用户**当前项目**的 `.xft-comat/`（不是插件目录）；脚本通过自身路径定位模板，与当前工作目录无关。

详见 [`skills/pilot/SKILL.md`](skills/pilot/SKILL.md)。

项目级用户需求与流程质量要求见 [`docs/requirements.md`](docs/requirements.md)。

## 设计要点

- `.xft-comat` 目录只能通过 `scripts/workflowctl.ts` 维护，不手动编辑。
- 澄清先行、路由后置：先通过公共阶段 `receive` / `explore-and-clarify` 消除关键不确定性，再用澄清后的任务摘要执行 `route`、`init` 并写 final route；审查必须早于最终验证/E2E。
- 轻量上下文：每个阶段只读必要文档；agent 职责保持原子，不维护工作流目录。
