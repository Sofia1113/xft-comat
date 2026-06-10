---
name: domain-modeling
description: xft-comat 领域驱动设计（DDD）建模方法论。在 plan 阶段对业务规则复杂或概念边界不清的任务，提炼通用语言、界定限界上下文、识别实体/值对象/聚合与领域服务，让设计围绕领域而非技术堆叠。供 architect 阅读后用于产出 02-design.md。
---

# 领域建模方法论（DDD）

在 xft-comat 的 `plan` 阶段使用本 skill——当任务的**业务规则复杂、概念多、边界不清或多模块协作**时。对纯技术性或单点改动的简单任务，不必强行套用，避免过度设计。

## 方法

1. **提炼通用语言（Ubiquitous Language）**：从需求与现有代码里抽出领域术语，确认每个词的确切含义，团队/代码/文档用同一套词。先探索代码已有命名，沿用而非新造。
2. **界定限界上下文（Bounded Context）**：识别本次改动落在哪个上下文，与其它上下文的边界与契约（谁拥有数据、跨边界如何通信、防腐层是否需要）。
3. **建模领域对象**：
   - **实体（Entity）**：有唯一标识、生命周期内可变。
   - **值对象（Value Object）**：无标识、按值相等、不可变（如金额、区间、坐标）。
   - **聚合（Aggregate）**：以聚合根为入口的一致性边界，外部只能引用根；定清不变量（invariant）。
   - **领域服务（Domain Service）**：不属于任何单一实体的领域行为。
4. **定不变量与规则归位**：把业务规则放进它该在的实体/聚合/服务里，避免贫血模型把规则散落到上层。
5. **映射到落地设计**：把领域模型映射成模块、接口、数据结构与改动点，在 02-design.md 的「待用户拍板的决策点」列出关键取舍（feature-hard 的拍板由主会话在 decide 阶段经 record-decision 写回，你不替用户填写「用户最终抉择」）。

## 边界

- 领域建模服务于设计清晰，不是为了引入框架或多加抽象层；简单任务保持简单。
- 只在 plan 阶段产出设计，不写业务代码（实现交给 implement 阶段的 tdd-engineer）。
- 若涉及前端视觉/交互，明确需要 frontend-design 参与的约束与验收点。

## 自录（你自己用 workflowctl.ts 写回）

```bash
node <script> submit --task-dir <task-dir> --stage plan --agent architect --doc 02-design.md --stdin [--evidence "<领域模型与设计证据>"]
node <script> add-task --task-dir <task-dir> --title "<拆分任务>" --owner <实现 agent> --kind implementation
```

## 产出（写入 02-design.md）

- 通用语言术语表与限界上下文边界。
- 实体/值对象/聚合/领域服务的划分与不变量。
- 推荐方案（必要时含最多 2 个备选）与多维比较（复杂度/风险/测试/迁移成本）。
- 需用户拍板的关键决策点。
