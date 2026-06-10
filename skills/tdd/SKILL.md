---
name: tdd
description: xft-comat 测试先行实现方法论。在 implement/fix 阶段先写或更新会失败的测试，再写最小实现使其通过，运行基础验证到可审查状态，并保留可解释的验证证据。供 tdd-engineer（重构场景配合 refactor-specialist）阅读后执行。
---

# 测试先行实现方法论（TDD）

在 xft-comat 的 `implement`、`fix` 阶段使用本 skill。核心纪律：**代码变更前，先有会失败的测试**；实现结束必须自带基础验证（verify 已并入 implement，不再单独分派）。

## 方法

1. **定位测试入口**：先找现有测试目录、框架、运行命令和命名约定，复用既有夹具与风格，不另起一套。
2. **先写失败测试**：把验收标准与边界翻译成测试用例（正常路径 + 边界 + 错误场景）。先运行确认它**因正确原因失败**（红）。
   - bugfix：先写能复现该 bug 的回归测试，确认它现在失败。
   - refactor：先确保有覆盖待改行为的保护测试（行为基线），它们当前应通过。
3. **最小实现**：只写让测试转绿所需的最小代码，不顺手扩范围、不加未被需求要求的能力。
4. **基础验证到可审查**：运行受影响的测试套件，确认转绿（绿）。记录命令、结果、证据；达不到可审查状态要说明失败原因与下一步。
5. **fix 阶段**：先按 code-reviewer 的“必补回归测试”补测试再改，修复后复跑受影响验证。修复 owner 应回到原实现 agent，不转给主会话。

## 边界

- 主会话不得直接编辑业务代码、测试或配置——这些只能由实现 agent 做。
- 实现末尾的基础验证只是冒烟，确认代码可审查；它不替代 `review`，也不替代 `final-verify`/完整 E2E。
- 失败必须可解释：写清楚失败原因、是否阻塞、下一步。

## 自录（你自己用 workflowctl.ts 写回，主会话不替你写）

```bash
node <script> new-test-round --task-dir <task-dir> --reason "初始用例设计"   # 首轮测试文档由你创建
node <script> submit --task-dir <task-dir> --stage <implement|fix> --agent tdd-engineer --doc <实现/测试相关文档> --stdin [--evidence "<测试先行与验证证据>"]
node <script> check-test --task-dir <task-dir> --round <n> --case "<用例>" --status passed|failed [--note "<说明>"]
```

用例必须先写进测试矩阵再 check-test（不会静默新增）。

script 路径与 `--task-dir` 见主会话分派提示（来自 next 输出）。

## 产出

- 失败测试或回归测试证据（先红后绿）。
- 最小实现说明。
- 基础验证命令、结果与是否达可审查状态。
- 审查后仍需复跑的清单。
