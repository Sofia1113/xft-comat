---
name: workflow-router
description: 在 xft-comat 路由阶段判定工作流 mode。读取 workflowctl.ts route 框架，区分 bugfix/refactor/feature，再按复杂度维度自评打分定档 simple/medium/hard，并产出 00-routing 的路由理由。由 pilot 主会话在澄清之后、init 之前调用。
---

# 工作流路由器

在 xft-comat 的 `route` 阶段使用本 skill。前提：`project-explorer` 已给出项目快照，`requirements-clarifier` 已把任务澄清到可路由。目标是选出唯一的工作流 mode，并写清楚理由。

路由判定由你（模型）做，脚本只提供评判框架——它不做关键词匹配，也不自动定级。

## 判定步骤

1. **拿框架**：运行 `route --task "<澄清后的摘要 + 显式假设>"`，读取返回的 `task_types`、`complexity_dimensions`、`scoring_bands`、`hard_floors`。
2. **先判类型**（类型优先于复杂度评分）：
   - 用户描述错误、异常、失败测试、回归、线上问题或现有行为不符预期 → **bugfix**。
   - 用户要求整理结构、重命名、拆分、性能清理、复用、架构改善，且要求**外部行为不变** → **refactor**。
   - 其余是新增或改变功能 → 进入复杂度评分定 feature 档。
3. **复杂度自评**：对 `complexity_dimensions` 七项逐项判断是否命中，每命中一项计 1 分：
   `requirements`(需求/边界/验收不明)、`scope`(≥3 文件或 ≥2 模块)、`infra`(API/DB/权限/异步/三方/计费/迁移/兼容)、`ui`(UI 流程/状态/可访问性/浏览器 E2E)、`decision`(架构取舍/方案比较/用户决策)、`risk`(安全/数据/回归/兼容/性能)、`test`(夹具/mock/浏览器/多轮验证)。
   注意 `risk`：任务涉及认证/授权/密码/凭据/权限/支付/加密时本维**强制计 1 分**，不得以"演示项目/骨架/无生产数据"为由计 0——风险评的是该类代码出错的后果模式，不是当前数据量。
4. **定档**：`0-2 → feature-simple`，`3-4 → feature-medium`，`≥5 → feature-hard`。
5. **硬底线核对**：逐条核对 `hard_floors`，任一命中即取「评分档」与「底线档」的**较高者**作为最终 mode。要点：新建/重构认证授权体系或安全敏感的分层结构 → 直接 `feature-hard`；涉及认证/会话/凭据/权限/支付/加密 → 最低 `feature-medium`；≥2 个新模块或用户要求拆分分层 → 最低 `feature-medium`；命中 `ui` 维度 → 最低 `feature-medium`。每条底线的命中/排除结论都要写进 00-routing.md，不能只在心里过一遍。
6. **UI 标记**：若命中 `ui` 维度，`init` 时必须加 `--ui true`（收尾门禁据此强制 E2E 与 frontend-design 决策不被静默降级）。UI 涉及面在 investigate/plan 才浮现时，用 `set-ui --value true` 补开。

## 落库（由 pilot 主会话执行）

```bash
node <script> route --task "<澄清后的摘要>"            # 拿框架（只含类型/维度/评分档）
node <script> init --topic "<短主题>" --mode <mode> --summary "<摘要>" [--ui true] [--runtime claude|codex]
node <script> set-doc --task-dir <task-dir> --doc 00-routing.md --stdin   # 写路由理由
node <script> set-doc --task-dir <task-dir> --doc 01-requirements.md --stdin
```

接收/探索/澄清/路由发生在 init 之前，不进入状态机；init 后 `current_stage` 直接落在第一个实质阶段，之后由 `next` 循环驱动。

## 00-routing.md 应包含

- 选定 mode 与一句话定档结论。
- 任务类型判断（为什么是 bugfix/refactor/feature）。
- 复杂度逐维度命中情况与总分（feature 档）。
- `hard_floors` 逐条命中/排除结论，以及底线是否抬高了评分档。
- 澄清如何改变或确认了类型、复杂度、风险、验收范围。
- 是否涉及 UI/E2E（决定 `--ui`）。

## 完成标准

- mode 唯一确定，且类型判断先于复杂度评分。
- 评分有逐维度依据，不是拍脑袋。
- `hard_floors` 已逐条核对，命中安全/多模块/UI 底线的任务没有被降档。
- UI 任务已置 `--ui true`。
- 00-routing.md 能让人复核“为什么是这个 mode”。
