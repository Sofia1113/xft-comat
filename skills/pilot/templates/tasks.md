# 实现任务列表：{{topic}}

- 日期：{{date}}
- 工作流模式：`{{mode}}`

## 任务

初始化后改写：本节由 `add-task` / `set-task` 命令程序维护并整体渲染，不要手改本文档。用 `add-task` 登记任务拆分、owner、类型（implementation/coordination）与状态；hard 流程实现、测试、前端落地、审查修复类任务不得把主会话作为 owner（须分派 specialist），编排/澄清/拍板/核验类可标 `--kind coordination`。交付前不得保留本说明与下方占位。

- [ ] TASK-001 — 待补充 — owner：待补充 — 状态：todo — 类型：implementation

## 完成定义

- 需求、设计或修复策略已覆盖任务边界。
- 测试先行或补齐回归测试；无法自动化时记录替代验证。
- 实现符合已确认需求和设计。
- 相关测试通过并有证据。
- 如有 UI，审查修复后完成 E2E 验证。
- 代码审查问题已处理或记录为残余风险。
