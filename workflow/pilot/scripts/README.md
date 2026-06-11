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
printf '%s' "<阶段产出>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" submit --task-dir .xft-comat/YYYY-MM-DD-topic --stage plan --executor worker-ro --doc 02-design.md --stdin
printf '%s' "<审查记录>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" submit --task-dir .xft-comat/YYYY-MM-DD-topic --stage review --executor worker-ro --doc 07-review.md --stdin
printf '%s' "<用户拍板结论>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-decision --task-dir .xft-comat/YYYY-MM-DD-topic --stdin
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-review --task-dir .xft-comat/YYYY-MM-DD-topic --blocking true --summary "P0：保存接口缺越权校验"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" skills list
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" skills check --require agent-browser,frontend-design
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-skill --task-dir .xft-comat/YYYY-MM-DD-topic --skill agent-browser --decision required --reason "UI E2E 验证必需" --evidence "agent-browser 已执行导航、表单操作和断言观察"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" record-stage --task-dir .xft-comat/YYYY-MM-DD-topic --stage final-verify --executor worker-ro --decision participated --evidence "E2E 用例全绿，agent-browser 导航/保存/断言证据见测试轮文档"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" add-task --task-dir .xft-comat/YYYY-MM-DD-topic --title "权限校验中间件（api/permission.ts + tests/permission.spec.ts）" --kind implementation --deps "TASK-001"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" set-task --task-dir .xft-comat/YYYY-MM-DD-topic --id TASK-001 --status done --evidence "permission.spec.ts 4 passed"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" new-test-round --task-dir .xft-comat/YYYY-MM-DD-topic --reason "初始用例设计" --if-missing true
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" add-test-case --task-dir .xft-comat/YYYY-MM-DD-topic --round 1 --case TC-001 --desc "类型：e2e — 目标：登录后保存成功"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" check-test --task-dir .xft-comat/YYYY-MM-DD-topic --round 1 --case TC-001 --status passed --note "登录流程通过"
printf '%s' "<本任务实现记录>" | node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" submit --task-dir .xft-comat/YYYY-MM-DD-topic --stage implement --executor worker --doc 02-design.md --stdin --append true --evidence "TASK-002 先红后绿"
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" validate --task-dir .xft-comat/YYYY-MM-DD-topic
node "<plugin-root>/workflow/pilot/scripts/workflowctl.ts" close --task-dir .xft-comat/YYYY-MM-DD-topic
```

## 使用要点

- 执行模型：**状态机定做什么，skill 定怎么做，worker 只管执行**。阶段的执行者是通用 worker 变体（`worker` 读写 / `worker-ro` 只读），由 `next` 的 `dispatch.agent` 指名；阶段专业方法论由 `dispatch.skill_paths` 指名的 SKILL.md 提供（worker 没有 Skill 工具，按绝对路径 Read）。
- `route` 只在最小必要澄清之后调用；输出只含路由决策所需框架（任务类型、复杂度维度、评分档），不含阶段 policy。
- 接收/探索/澄清/路由发生在 `init` 之前，不进入状态机；`init` 后 `current_stage` 直接落在第一个实质阶段，无需额外 advance。
- 阶段序列按模式分层：`feature-simple` 为 implement→review→fix→final-verify→close；`feature-medium` 在前面加 plan；`feature-hard` 为 plan→decide→implement→…；`bugfix` 以 investigate 开头；`refactor` 为 investigate→plan→…。verify 已并入 implement。
- `next` 是阶段循环的核心：返回当前阶段的"分派包"——`stage`、`dispatch`（worker 变体 + skill 路径）、`inputs`（含**本阶段输入白名单文档**；plan 阶段附 `available_skills`，fix 阶段附 `review` 结论）、`outputs_expected`、`quality_gate`、`record_instructions`、`advance_to`。`next` 是只读命令：**被分派的 worker 自己跑 `next` 取分派包**（消除主会话转述丢字段），但 `advance`/`close` 只归 pilot 主会话。fix 阶段在 review 无阻塞发现时返回 `skip_recommended: true`，pilot 直接 advance（程序会把 fix 标为 `skipped`）。
- **证据键 = 阶段 + 执行者**：`submit` = `set-doc` + 阶段执行记录合一（`--executor worker|worker-ro|main`）；不经 submit 落库的阶段（如 final-verify 全走 check-test）用 `record-stage` 登记执行。participated 必带 `--evidence`，skipped 必带 `--reason`，`--executor main`（主会话兜底：无 subagent 运行时或分派失败）必带 `--reason`——main 顶替必须显式留痕。
- submit 会校验当前阶段允许的主文档，review/fix 写入 review 专用文档，不得覆盖 `02-design.md` / `02-design-note.md`。
- **任务拆分与并发实现**：plan 按 `task-splitting` skill 把实现任务拆成「一个测试点 + 最小实现」的独立任务（文件范围互不相交是硬约束，重叠用 `--deps` 串联；`add-task` 的 owner 缺省即 `worker`）。implement/fix 阶段 `next` 会附 `inputs.pending_tasks`，待办 ≥ 2 时 `dispatch.parallel: true`，pilot 据此按依赖分波、同一波内每任务并发分派一个独立 worker。写类子命令对任务目录加写锁（`.lock`），并发自录安全；并发批次中 `submit` 用 `--append true` 追加小节（同阶段执行证据自动合并），用例登记用 `add-test-case`（逐条追加，含查重；TC 编号建议带任务序号前缀防撞号），首轮建测试文档用 `new-test-round --if-missing true`（已有轮次直接复用）。
- `record-review` 是 review 阶段的硬要求：`--blocking false` 时 fix 自动跳过；`--blocking true` 时 validate 强制 fix 实际闭环。
- `record-decision` 由主会话在 decide 阶段执行，把用户拍板结论写入设计文档开头的「用户最终抉择」节；这是路由两文档之外主会话唯一的常规落库点。
- `init --ui true` 表示任务涉及 UI/E2E；后续才发现 UI 范围用 `set-ui --value true` 补开门禁。`init --runtime codex` 标记无 subagent 的运行时（阶段可由主会话以 `--executor main` + reason 自录通过门禁）。
- 测试用例文档由 `new-test-round` 懒创建（首轮不递增轮次）；用例用 `add-test-case` 逐条登记进测试矩阵（首次登记会移除模板示例注释）；`check-test` 只更新已登记用例，匹配不到会报错而不是静默追加。
- implementation task 完成后必须用 `set-task --status done --evidence ...` 标记；close 前仍为 `todo` / `doing` / `blocked` 的实现任务会阻断 validate。
- `validate` / `close` 检查：占位哨兵（`<!-- XFT-TODO`）、阶段遍历（所有实质阶段 completed/skipped 才能 close）、review 结论与 fix 闭环、feature-hard 的 plan/implement/review 阶段执行记录、UI/E2E 决策（final-verify 执行记录 + agent-browser/frontend-design）、审查顺序、测试闭环、任务 owner 和实现任务完成状态。
- `.xft-comat` 的直接写入在 Claude Code 下由插件 PreToolUse hook（`hooks/guard-xft-dir.mjs`）拦截；Codex 无 hook 机制，仅靠约定。

脚本输出与 `workflowctl.ts` 内置门禁是最终行为真源；文档示例只用于快速调用。
