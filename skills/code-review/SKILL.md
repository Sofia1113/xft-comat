---
name: code-review
description: xft-comat 代码审查方法论与检查清单。在 review 阶段（实现与基础验证之后、final-verify 之前）审查变更，优先 correctness、安全、回归与测试缺口，按严重度给出带文件:行号的发现，并指明必补回归测试与必复跑路径。供 code-reviewer 阅读后执行。
---

# 代码审查方法论

在 xft-comat 的 `review` 阶段使用本 skill。前提：`implement` 已产出变更与基础验证（verify 已并入 implement）。审查必须早于 `final-verify`，且不能由主会话自检替代。

## 审查顺序与清单

1. **符合度**：对照 `01-requirements.md` 与设计文档（`02-design.md` / `02-reproduction.md` / `02-refactor-plan.md`）以及用户关键决策，确认实现确实满足需求、没有偏离已定方案。
2. **correctness（优先）**：边界条件、空值/异常、并发与顺序、错误处理、资源释放、off-by-one、状态一致性、回退路径。
3. **安全**：输入校验、注入、认证授权、敏感数据（密码必须哈希存储、token 策略明确）、越权、机密泄漏。发现安全风险时建议进入 security-review，不在本阶段替代安全审查。
4. **回归**：本次改动是否破坏既有行为或相邻路径；refactor 任务确认外部行为等价。
5. **测试覆盖**：是否覆盖新增/变更逻辑、边界与错误场景；标出**必须补的回归测试**。
6. **可维护性（次要）**：命名、重复、复杂度、与既有模式一致性——不喧宾夺主。

## 发现格式

按严重度 P0/P1/P2 列出，每条含：`文件:行号` — 问题 — 影响 — 建议。区分“阻塞（必须修）”与“建议”。

## 闭环要求

- 审查发现必须回交原实现专职 agent 在 `fix` 阶段闭环（补回归测试 + 修复 + 复跑），不转回主会话。
- 指明修复后必须复跑的验证路径（自动化测试、E2E 路径）。
- 若发现影响设计，标注是否需要重新审查。

## 自录（你自己用 workflowctl.ts 写回）

```bash
node <script> submit --task-dir <task-dir> --stage review --agent code-reviewer --doc <skill-usage 或评审记录文档> --stdin [--evidence "<审查发现与结论>"]
node <script> record-review --task-dir <task-dir> --blocking true|false [--summary "<阻塞发现摘要>"]
```

`record-review` **必须执行**：无阻塞发现 `--blocking false`（fix 阶段自动跳过）；有阻塞发现 `--blocking true --summary "<摘要>"`（fix 阶段的闭环输入，validate 据此强制 fix 不得跳过）。

script 路径与 `--task-dir` 见主会话分派提示（来自 next 输出）。

## 产出

- 审查结论（是否有阻塞）。
- 按严重度排序、带文件:行号的发现。
- 测试缺口与必补回归测试清单。
- 修复后必复跑路径与是否需重新审查。
- 残余风险。
