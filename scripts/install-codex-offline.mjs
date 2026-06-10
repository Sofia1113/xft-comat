#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CODEX_HOME = process.env.CODEX_HOME
  ? path.resolve(process.env.CODEX_HOME)
  : path.join(homedir(), ".codex");
const DEFAULT_MARKETPLACE_NAME = "xft-comat-local";
const DEFAULT_MARKETPLACE_ROOT = path.join(
  DEFAULT_CODEX_HOME,
  "offline-marketplaces",
  "xft-comat",
);

const EXCLUDED_ROOT_NAMES = new Set([
  ".DS_Store",
  ".agents",
  ".baoyu-skills",
  ".claude",
  ".firecrawl",
  ".git",
  ".xft-comat",
  "node_modules",
]);

const args = parseArgs(process.argv.slice(2));
const manifest = readJson(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"));
const pluginName = manifest.name;
if (!pluginName || typeof pluginName !== "string") {
  fail("缺少 .codex-plugin/plugin.json 的 name 字段。");
}

const marketplaceName = args.marketplaceName || DEFAULT_MARKETPLACE_NAME;
const marketplaceRoot = path.resolve(args.marketplaceRoot || DEFAULT_MARKETPLACE_ROOT);
const stagedPluginDir = path.join(marketplaceRoot, "plugins", pluginName);
const marketplacePath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");

if (args.help) {
  printHelp();
  process.exit(0);
}

log(`插件根目录：${PLUGIN_ROOT}`);
log(`Marketplace 根目录：${marketplaceRoot}`);
log(`Marketplace 名称：${marketplaceName}`);
log(`暂存插件目录：${stagedPluginDir}`);

if (args.dryRun) {
  log("仅预览操作；不会写入文件，也不会运行 Codex 命令。");
} else {
  stagePlugin();
  writeMarketplace();
}

if (args.skipCodexAdd) {
  log("已按 --skip-codex-add 跳过 Codex CLI 注册。");
  printManualCommands();
  process.exit(0);
}

if (args.dryRun) {
  log(`将运行：codex plugin marketplace add ${shellQuote(marketplaceRoot)}`);
  log(`将运行：codex plugin add ${pluginName}@${marketplaceName}`);
  process.exit(0);
}

runCodexCommand(["plugin", "marketplace", "add", marketplaceRoot], {
  continueOnAlreadyConfigured: true,
});
runCodexCommand(["plugin", "add", `${pluginName}@${marketplaceName}`]);

log("已将 xft-comat 安装到 Codex。请新开一个 Codex thread 以加载插件。");

function parseArgs(rawArgs) {
  const parsed = {
    dryRun: false,
    help: false,
    marketplaceName: "",
    marketplaceRoot: "",
    skipCodexAdd: false,
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--skip-codex-add") {
      parsed.skipCodexAdd = true;
    } else if (arg === "--marketplace-name") {
      parsed.marketplaceName = requireValue(rawArgs, ++i, arg);
    } else if (arg === "--marketplace-root") {
      parsed.marketplaceRoot = requireValue(rawArgs, ++i, arg);
    } else {
      fail(`无法识别的参数：${arg}`);
    }
  }
  return parsed;
}

function requireValue(rawArgs, index, flag) {
  const value = rawArgs[index];
  if (!value || value.startsWith("--")) {
    fail(`参数 ${flag} 缺少取值。`);
  }
  return value;
}

function printHelp() {
  console.log(`从本地文件安装 xft-comat 到 Codex。

用法：
  node scripts/install-codex-offline.mjs [options]

选项：
  --dry-run                  只打印计划执行的操作，不写入文件。
  --skip-codex-add           暂存文件并生成 marketplace JSON，但不运行 codex 命令。
  --marketplace-root <path>  本地 marketplace 根目录。默认：${DEFAULT_MARKETPLACE_ROOT}
  --marketplace-name <name>  marketplace 名称。默认：${DEFAULT_MARKETPLACE_NAME}
  -h, --help                 显示帮助。
`);
}

function stagePlugin() {
  if (isSubpath(stagedPluginDir, PLUGIN_ROOT) || path.resolve(stagedPluginDir) === PLUGIN_ROOT) {
    fail("拒绝把插件暂存在源插件目录内部。");
  }
  rmSync(stagedPluginDir, { force: true, recursive: true });
  mkdirSync(stagedPluginDir, { recursive: true });
  for (const entry of [
    ".codex-plugin",
    ".claude-plugin",
    "agents",
    "commands",
    "docs",
    "skills",
    "scripts",
    "workflow",
    "README.md",
    "package.json",
  ]) {
    const source = path.join(PLUGIN_ROOT, entry);
    if (!existsSync(source) || EXCLUDED_ROOT_NAMES.has(entry)) {
      continue;
    }
    cpSync(source, path.join(stagedPluginDir, entry), {
      recursive: true,
      filter: shouldCopy,
    });
  }
  log("已暂存插件文件。");
}

function shouldCopy(source) {
  const base = path.basename(source);
  if (base === ".DS_Store" || base === "node_modules") {
    return false;
  }
  const relative = path.relative(PLUGIN_ROOT, source);
  const first = relative.split(path.sep)[0];
  return !EXCLUDED_ROOT_NAMES.has(first);
}

function writeMarketplace() {
  const marketplaceDir = path.dirname(marketplacePath);
  mkdirSync(marketplaceDir, { recursive: true });
  const marketplace = existsSync(marketplacePath)
    ? readJson(marketplacePath)
    : {
        name: marketplaceName,
        interface: {
          displayName: "xft-comat Local",
        },
        plugins: [],
      };

  if (!marketplace.name) {
    marketplace.name = marketplaceName;
  }
  if (marketplace.name !== marketplaceName) {
    fail(
      `Marketplace 已存在，名称为 "${marketplace.name}"。` +
        `请使用 --marketplace-name ${marketplace.name}，或选择不同的 --marketplace-root。`,
    );
  }
  if (!marketplace.interface || typeof marketplace.interface !== "object") {
    marketplace.interface = { displayName: "xft-comat Local" };
  }
  if (!Array.isArray(marketplace.plugins)) {
    marketplace.plugins = [];
  }

  const entry = {
    name: pluginName,
    source: {
      source: "local",
      path: `./plugins/${pluginName}`,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  };
  const index = marketplace.plugins.findIndex((plugin) => plugin && plugin.name === pluginName);
  if (index === -1) {
    marketplace.plugins.push(entry);
  } else {
    marketplace.plugins[index] = entry;
  }

  writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf-8");
  log(`已写入 marketplace：${marketplacePath}`);
}

function runCodexCommand(commandArgs, options = {}) {
  const printable = `codex ${commandArgs.map(shellQuote).join(" ")}`;
  log(`正在运行：${printable}`);
  const result = spawnSync("codex", commandArgs, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(`无法运行 "${printable}"：${result.error.message}`);
    printManualCommands();
    process.exit(1);
  }

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    if (
      options.continueOnAlreadyConfigured &&
      /already|exists|configured|duplicate/i.test(output)
    ) {
      log("Marketplace 似乎已经配置过，继续执行。");
      return;
    }
    console.error(output || `命令失败，退出码：${result.status}。`);
    printManualCommands();
    process.exit(result.status || 1);
  }
  if (output) {
    console.log(output);
  }
}

function printManualCommands() {
  console.log(`
手动离线安装命令：
  codex plugin marketplace add ${shellQuote(marketplaceRoot)}
  codex plugin add ${pluginName}@${marketplaceName}
`);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    fail(`无法从 ${filePath} 读取 JSON：${error.message}`);
  }
}

function isSubpath(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isDir(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function log(message) {
  console.log(`[xft-comat] ${message}`);
}
