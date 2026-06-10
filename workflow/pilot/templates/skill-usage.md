# Skill 使用记录：{{topic}}

- 日期：{{date}}
- 工作流模式：`{{mode}}`

## 候选 skill

<!-- plan 阶段从 next 输出的 available_skills 里筛选后记录：只记录会实质改变执行方式的候选项与决策；optional 项由主会话向用户确认。无候选时本节保持默认文案即可。 -->

暂无候选 skill 记录。

## Agent 参与记录

<!-- 本节由 record-agent / submit 命令程序维护并整体渲染，不要手改本节。每个专职 agent 记一条 participated（带实质参与证据）或 skipped（带未使用原因）。feature-hard 必须覆盖 architect、tdd-engineer、code-reviewer，涉及 UI/E2E 时还须覆盖 e2e-verifier。指挥/编排由 pilot 主会话承担，无需登记。 -->

暂无 agent 参与记录，使用 record-agent 登记。

## 固定规则

如任务包含 UI、浏览器流程、权限页面、登录、表单、导航、可视状态或 E2E：

- 必须把 `agent-browser` 记录为 required，并在下方使用记录中补入真实浏览器操作证据。
- 前端视觉、布局、交互体验任务，还必须把 `frontend-design` 记录为 required，并补入设计约束或可用性检查结论。

## 使用记录

<!-- 本节由 record-skill 命令程序追加（追加位置自动落入本章节）。每条记录一个 required/accepted/declined/skipped/downgraded/blocked 决策、原因与证据。若全程没有任何 skill 实质参与，保持默认文案即可。 -->

暂无 skill 使用记录。
