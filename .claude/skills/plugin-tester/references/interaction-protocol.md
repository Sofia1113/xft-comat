# 交互协议 — 在 tmux 里跟 Claude Code TUI 对话

`xft-comat` 工作流的用户交互通常出现在三类位置：需求澄清、真实设计取舍、执行或验证前的确认。这个文件只描述机械操作；具体怎么选，结合 `test-prompts.md` 的“决策模拟参考”和屏幕上的问题临场判断。

## tmux key 别名

`obt-send` 把 `@<name>` 当作 tmux key。

| 别名 | 含义 |
|------|------|
| `@Enter` | 回车提交 |
| `@Down` / `@Up` | 选项导航 |
| `@Space` | 多选切换 |
| `@Tab` | 在选项和 Other 输入框间跳焦 |
| `@Escape` | 取消当前弹窗或退出焦点 |
| `@C-c` | Ctrl+C 中断 |

## 自然语言澄清问题

如果屏幕只是普通输入框等待回答，而不是选项列表，直接发送文本和回车：

```bash
obt-send "内存存储即可，重启后数据可以清空；测试用 node:test。" @Enter
```

回答要短而明确，帮助 workflow 继续推进。不要在回答里告诉它“走 feature-hard”或“调用某阶段”，否则会污染路由测试。

## AskUserQuestion 单选

UI 形式通常是多行选项，当前焦点在第一项：

```text
> Option A (Recommended)
  Option B
  Option C
```

应答模板：

```bash
# 选第一个
obt-send @Enter

# 选第二个
obt-send @Down @Enter

# 选第三个
obt-send @Down @Down @Enter

# 选 Other 并输入自由文本（Down 次数按实际选项数调整）
obt-send @Down @Down @Down @Enter
sleep 0.3
obt-send "自定义答案内容" @Enter
```

## AskUserQuestion 多选

UI 形式通常是 `[ ]` 选项。用 Space 切换，Enter 提交：

```bash
obt-send @Space @Down @Down @Space @Enter
```

## 决策多样性

测试插件稳定性时，不要每次都选 Recommended。建议跨 prompt 轮换：

- `feature-simple`：轻量确认，选第 2 项或直接批准。
- `feature-medium`：如果出现技术取舍，选中间项；可有一题用 Other 给具体约束。
- `feature-hard`：至少一题 Other，给明确安全或架构偏好。
- `bugfix`：尽量少往返，批准最小修复和回归测试。
- `refactor`：强调行为不变和安全网，必要时选择保守方案。

## 一轮交互流程

1. `obt-snap` 看完整屏幕，确认在等输入而不是 Claude 仍在 streaming。
2. 判断是普通文本澄清、单选还是多选。
3. 给出不会污染 mode 路由的产品/工程决策。
4. `obt-send` 输入。
5. 再 `obt-snap` 复核：应进入下一问题、执行命令或继续输出。

## 等输入的常见特征

- 出现 `↑/↓ navigate`、`↑↓ to select` 或类似提示。
- 多行选项前出现 `>`、`○`、`●`、`[ ]`、`[x]`。
- `obt-watch` 显示 `idle_sec > 20`，末尾没有 `esc to interrupt`。
- 普通 prompt 行等待输入，且没有工具调用或输出继续增长。

## 已完成的常见特征

- 出现“完成”“交付”“close”“Done”“workflow 记录目录”等结束语。
- 末尾回到输入 prompt。
- `obt-watch` 显示 `idle_sec > 30`，没有新工具调用、没有等待选项。

## 反例

- 不要在 AskUserQuestion 中发送 `yes` 文本；如果没有 Other 输入框，文本会被忽略或误解析。
- 不要连按 `@Enter` 试图跳过所有确认；这会让决策失真。
- 不要在 Claude 还显示 `esc to interrupt` 时发输入；很可能被吞。
- 不要回答“请使用 feature-hard/bugfix workflow”；测试目标是让插件自己路由。
