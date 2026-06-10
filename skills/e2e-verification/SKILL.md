---
name: e2e-verification
description: xft-comat 端到端验证方法论。在 final-verify 阶段（代码审查问题修复之后）把测试用例还原成真实用户路径执行回归，UI/浏览器流程必须配合 agent-browser 取得真实页面证据，不能用单元测试或 build 冒充 E2E。供 e2e-verifier 阅读后执行。
---

# 端到端验证方法论（E2E）

在 xft-comat 的 `final-verify` 阶段使用本 skill。前提：`review` 已完成、审查发现已在 `fix` 阶段闭环。目标是从真实用户视角确认改动端到端可用、无回归。

## 方法

1. **转用户路径**：把测试用例与验收标准翻译成真实用户操作路径（打开什么、点什么、填什么、期望看到什么）。
2. **明确启动条件**：应用如何启动、URL、账号、测试数据、前置状态。条件不具备就显式记录为阻塞，不假装验证过。
3. **执行真实回归**：
   - **UI / 浏览器流程**：必须使用 `agent-browser` skill 驱动真实浏览器，观察可访问性树与页面行为取证。要求主会话调用 `agent-browser`（你自己没有该工具时，在记录里标注需要主会话执行）。
   - **非 UI**：跑端到端的真实链路（API → 服务 → 存储 等），不只跑单元测试。
4. **确认审查闭环**：核对审查发现确已修复，且修复未引入新回归。
5. **记录结果并判断是否新轮**：逐用例记 通过/失败；若验收范围或失败假设变了，开新测试轮。

## 边界

- **不能用单元测试或 build 成功冒充 E2E**；UI 任务缺少真实浏览器证据就是没通过。
- 不用 E2E 替代代码审查（审查在 review 阶段已做）。
- 必须发生在 review/fix 之后。

## 自录（你自己用 workflowctl.ts 写回）

```bash
node <script> check-test --task-dir <task-dir> --round <n> --case "<用户路径用例>" --status passed|failed [--note "<证据/失败>"]
node <script> new-test-round --task-dir <task-dir> --reason "<验收范围或失败假设变化>"   # 仅当需要新轮
node <script> record-agent --task-dir <task-dir> --agent e2e-verifier --decision participated --evidence "<真实用户路径与浏览器证据>"
node <script> record-skill --task-dir <task-dir> --skill agent-browser --decision required --reason "UI/E2E 需真实页面验证" --evidence "<agent-browser 操作证据>"
```

## 产出

- E2E 范围与启动条件。
- 审查后回归状态与 agent-browser 使用情况。
- 逐用例通过/失败结果（对应 test-cases 文档）。
- 失败项与下一轮建议。
