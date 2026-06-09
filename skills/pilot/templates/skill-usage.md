# Skill 使用记录：{{topic}}

- 日期：{{date}}
- 工作流模式：`{{mode}}`

## 候选 skill

初始化后改写：记录实现前通过 `skills list` 发现的相关 skill、决策和是否需要询问用户；只记录会实质改变执行方式的候选项。无候选时写明“无候选 skill”。

## Agent 参与记录

初始化后改写：本节由 `record-agent` 命令程序维护并整体渲染，不要手改本节。每个 specialist 记一条 `participated`（带 `--evidence` 实质参与证据）或 `skipped`（带 `--reason` 未使用原因）。hard 流程必须覆盖 `conductor`、`architect`、`tdd-engineer`、`code-reviewer`，涉及 UI/E2E 时还须覆盖 `e2e-verifier`。需求澄清由主会话主持，无需点名 specialist。交付前不得保留本说明。

## 固定规则

如任务包含 UI、浏览器流程、权限页面、登录、表单、导航、可视状态或 E2E：

- 必须把 `agent-browser` 记录为 required，并在下方使用记录中补入真实浏览器操作证据。
- 前端视觉、布局、交互体验任务，还必须把 `frontend-design` 记录为 required，并补入设计约束或可用性检查结论。

## 使用记录

初始化后改写：本节由 `record-skill` 命令程序追加（追加位置自动落入本章节，与章节在文档中的位置无关），每条记录一个 `required`/`accepted`/`declined`/`skipped` skill 决策、原因与实质参与证据，格式为 `- \`skill-name\` — 决策 — 原因 — 证据：...`；required 记录必须带“证据：”字段。若全程没有任何 skill 实质参与，写明“无 skill 实质参与，因为...”。交付前删除本说明行，只保留实际记录。
