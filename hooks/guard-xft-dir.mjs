#!/usr/bin/env node
// PreToolUse 守卫：把".xft-comat 只能通过 workflowctl.ts 维护"从 prompt 约束
// 变成程序强制。拦截两类直接写入：
//   1. Edit/Write/MultiEdit/NotebookEdit 的 file_path 落在 .xft-comat/ 内；
//   2. Bash 命令疑似直接写 .xft-comat（重定向、tee、sed -i、rm/mv/cp 目标），
//      但放行 workflowctl 调用本身（其 --task-dir 参数必然包含 .xft-comat）。
// 仅在 Claude Code 生效（Codex 无 hook 机制）；读取失败时放行，不阻塞正常流程。

import process from "node:process";
import { readFileSync } from "node:fs";

let input = "";
try {
  input = readFileSync(0, "utf-8");
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const toolName = payload.tool_name || "";
const toolInput = payload.tool_input || {};

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const XFT_DIR = ".xft-comat";

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(toolName)) {
  const filePath = String(toolInput.file_path || toolInput.notebook_path || "");
  if (filePath.includes(`${XFT_DIR}/`) || filePath.endsWith(XFT_DIR)) {
    deny(
      ".xft-comat 只能通过插件的 workflowctl.ts 维护（set-doc/submit/record-* 等子命令），" +
        "不要直接编辑该目录下的文件。",
    );
  }
}

if (toolName === "Bash") {
  const command = String(toolInput.command || "");
  if (command.includes(XFT_DIR) && !command.includes("workflowctl")) {
    // 只拦截明显的写操作；cat/ls/grep 等只读访问放行。
    const writePattern =
      />\s*[^|]*\.xft-comat|tee\s+[^|]*\.xft-comat|sed\s+-i[^|]*\.xft-comat|(rm|mv|cp|touch|mkdir)\s+[^|]*\.xft-comat/;
    if (writePattern.test(command)) {
      deny(
        "检测到对 .xft-comat 的直接写入。该目录只能通过插件的 workflowctl.ts 维护" +
          "（set-doc/submit/record-* 等子命令）。",
      );
    }
  }
}

process.exit(0);
