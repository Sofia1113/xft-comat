# workflowctl.ts 使用说明

`workflowctl.ts` 是 `.xft-comat/` 的唯一写入入口。脚本通过自身路径定位模板，但所有 `--task-dir`、`.xft-comat` 相对路径都相对用户当前项目。

`<plugin-root>` 表示插件安装目录。在 Claude Code 中可用 `${CLAUDE_PLUGIN_ROOT}` 拼路径；在 Codex 中使用已安装插件的实际文件路径，或从当前插件目录运行 `workflow/pilot/scripts/workflowctl.ts`。

## 常用命令

```bash
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" route --task "<澄清后的任务摘要>"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" init --topic "<topic>" --mode <final-mode> --summary "<任务摘要>" --ui true --runtime claude
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" next --task-dir .xft-comat/YYYY-MM-DD-topic
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" advance --task-dir .xft-comat/YYYY-MM-DD-topic --stage <next 返回的 advance_to>
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" status --task-dir .xft-comat/YYYY-MM-DD-topic
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" set-ui --task-dir .xft-comat/YYYY-MM-DD-topic --value true
printf '%s' "<长内容>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" set-doc --task-dir .xft-comat/YYYY-MM-DD-topic --doc 01-requirements.md --stdin
printf '%s' "<阶段产出>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" submit --task-dir .xft-comat/YYYY-MM-DD-topic --stage plan --agent architect --doc 02-design.md --stdin
printf '%s' "<审查记录>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" submit --task-dir .xft-comat/YYYY-MM-DD-topic --stage review --agent code-reviewer --doc 07-review.md --stdin
printf '%s' "<用户拍板结论>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-decision --task-dir .xft-comat/YYYY-MM-DD-topic --stdin
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-review --task-dir .xft-comat/YYYY-MM-DD-topic --blocking true --summary "P0：保存接口缺越权校验"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" skills list
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" skills check --require agent-browser,frontend-design
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-skill --task-dir .xft-comat/YYYY-MM-DD-topic --skill agent-browser --decision required --reason "UI E2E 验证必需" --evidence "agent-browser 已执行导航、表单操作和断言观察"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-agent --task-dir .xft-comat/YYYY-MM-DD-topic --agent e2e-verifier --decision skipped --reason "本任务无 UI/E2E"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" add-task --task-dir .xft-comat/YYYY-MM-DD-topic --title "实现权限校验中间件" --owner tdd-engineer --kind implementation --status doing
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" set-task --task-dir .xft-comat/YYYY-MM-DD-topic --id TASK-001 --status done --evidence "permission.spec.ts 4 passed"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" new-test-round --task-dir .xft-comat/YYYY-MM-DD-topic --reason "初始用例设计"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" check-test --task-dir .xft-comat/YYYY-MM-DD-topic --round 1 --case TC-001 --status passed --note "登录流程通过"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" validate --task-dir .xft-comat/YYYY-MM-DD-topic
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" close --task-dir .xft-comat/YYYY-MM-DD-topic
```

## 使用要点

- `route` 只在最小必要澄清之后调用；输出只含路由决策所需框架（任务类型、复杂度维度、评分档），不含阶段 policy。
- 接收/探索/澄清/路由发生在 `init` 之前，不进入状态机；`init` 后 `current_stage` 直接落在第一个实质阶段，无需额外 advance。
- 阶段序列按模式分层：`feature-simple` 为 implement→review→fix→final-verify→close；`feature-medium` 在前面加 plan；`feature-hard` 为 plan→decide→implement→…；`bugfix` 以 investigate 开头；`refactor` 为 investigate→plan→…。verify 已并入 implement。
- `next` 是 pilot 阶段循环的核心：返回当前阶段的"分派包"——`stage`、`dispatch`、`inputs`（含**本阶段输入白名单文档**；plan 阶段附 `available_skills`，fix 阶段附 `review` 结论）、`outputs_expected`、`quality_gate`、`record_instructions`、`advance_to`。fix 阶段在 review 无阻塞发现时返回 `skip_recommended: true`，pilot 直接 advance（程序会把 fix 标为 `skipped`）。
- `submit` = `set-doc` + `record-agent participated` 合一，agent 优先用它写回本阶段产出；submit 会校验当前阶段允许的主文档，review/fix 写入 review 专用文档，不得覆盖 `02-design.md` / `02-design-note.md`。
- `record-review` 是 review 阶段的硬要求：`--blocking false` 时 fix 自动跳过；`--blocking true` 时 validate 强制 fix 实际闭环。
- `record-decision` 由主会话在 decide 阶段执行，把用户拍板结论写入设计文档开头的「用户最终抉择」节；这是路由两文档之外主会话唯一的合法落库点。
- `init --ui true` 表示任务涉及 UI/E2E；后续才发现 UI 范围用 `set-ui --value true` 补开门禁。`init --runtime codex` 标记无 subagent 的运行时（专职 agent 可记 skipped + runtime 原因）。
- 测试用例文档由 `new-test-round` 懒创建（首轮不递增轮次）；`check-test` 只更新已登记用例，匹配不到会报错而不是静默追加。
- implementation task 完成后必须用 `set-task --status done --evidence ...` 标记；close 前仍为 `todo` / `doing` / `blocked` 的实现任务会阻断 validate。
- `validate` / `close` 检查：占位哨兵（`<!-- XFT-TODO`）、阶段遍历（所有实质阶段 completed/skipped 才能 close）、review 结论与 fix 闭环、required 专职 agent 记录、UI/E2E 决策、审查顺序、测试闭环、任务 owner 和实现任务完成状态。
- `.xft-comat` 的直接写入在 Claude Code 下由插件 PreToolUse hook（`hooks/guard-xft-dir.mjs`）拦截；Codex 无 hook 机制，仅靠约定。

脚本输出与 `workflowctl.ts` 内置门禁是最终行为真源；文档示例只用于快速调用。
