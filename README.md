# xft-comat

Claude Code 插件：把 **xft-comat Workflow** —— 一套轻量、程序驱动的 AI Coding 工作流 —— 打包成可安装、可分发、可版本化的插件。

适用于需要受控执行的非平凡任务：新功能、bug 修复、重构。提供智能路由（按复杂度分级）、专职 subagent 团队、TDD、E2E 验证，并把可追踪记录持久化到用户项目的 `.xft-comat` 目录。

## 插件结构

```
xft-comat/                         # 插件根
├── .claude-plugin/
│   └── plugin.json                # 插件清单（name: xft-comat）
├── skills/
│   └── pilot/                     # 主 skill：/xft-comat:pilot
│       ├── SKILL.md
│       ├── scripts/workflowctl.py # 唯一的 .xft-comat 写入入口
│       ├── templates/             # 各阶段文档模板
│       └── evals/evals.json       # skill 评测用例
└── agents/                        # 8 个专职 subagent，安装后自动加载
    │                              # 文件名不带前缀；agent 名由各文件 frontmatter
    │                              # 的 name 字段提供，统一带 xft-comat- 前缀
    ├── conductor.md               # → xft-comat-conductor
    ├── architect.md               # → xft-comat-architect
    ├── tdd-engineer.md            # → xft-comat-tdd-engineer
    ├── bug-diagnostician.md       # → xft-comat-bug-diagnostician
    ├── refactor-specialist.md     # → xft-comat-refactor-specialist
    ├── e2e-verifier.md            # → xft-comat-e2e-verifier
    ├── code-reviewer.md           # → xft-comat-code-reviewer
    └── skill-scout.md             # → xft-comat-skill-scout
```

## 安装与使用

### 本地开发 / 试用

直接用 `--plugin-dir` 加载本目录：

```bash
claude --plugin-dir /Users/sofia/WorkSpace/xft-comat
```

启动后在会话内运行 `/reload-plugins` 可热加载改动。

### 通过 marketplace 安装

把本仓库加入某个 marketplace 的 `marketplace.json` 后，用户即可：

```text
/plugin marketplace add <your-marketplace-repo>
/plugin install xft-comat@<marketplace-name>
```

### 验证

```bash
claude plugin validate /Users/sofia/WorkSpace/xft-comat
```

## 用法

安装并启用后：

- 主 skill 调用名为 `/xft-comat:pilot`，也会在合适的任务上下文中被 Claude 自动触发。
- 9 个专职 agent 会自动出现在 `/agents` 列表中，按工作流阶段最小必要地分派。
- 工作流目录写入用户**当前项目**的 `.xft-comat/`（不是插件目录）；脚本通过 `${CLAUDE_PLUGIN_ROOT}` 定位自身，与当前工作目录无关。

详见 [`skills/pilot/SKILL.md`](skills/pilot/SKILL.md)。

项目级用户需求与流程质量要求见 [`docs/requirements.md`](docs/requirements.md)。

## 设计要点

- `.xft-comat` 目录只能通过 `scripts/workflowctl.py` 维护，不手动编辑。
- 路由先行但不定死：先形成 provisional route 决定澄清深度，需求明确后再写 final route；审查必须早于最终验证/E2E。
- 轻量上下文：每个阶段只读必要文档；agent 职责保持原子，不维护工作流目录。
