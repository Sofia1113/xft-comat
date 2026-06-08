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
  fail("Missing .codex-plugin/plugin.json name.");
}

const marketplaceName = args.marketplaceName || DEFAULT_MARKETPLACE_NAME;
const marketplaceRoot = path.resolve(args.marketplaceRoot || DEFAULT_MARKETPLACE_ROOT);
const stagedPluginDir = path.join(marketplaceRoot, "plugins", pluginName);
const marketplacePath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");

if (args.help) {
  printHelp();
  process.exit(0);
}

log(`Plugin root: ${PLUGIN_ROOT}`);
log(`Marketplace root: ${marketplaceRoot}`);
log(`Marketplace name: ${marketplaceName}`);
log(`Staged plugin: ${stagedPluginDir}`);

if (args.dryRun) {
  log("Dry run only; no files will be written and no Codex commands will run.");
} else {
  stagePlugin();
  writeMarketplace();
}

if (args.skipCodexAdd) {
  log("Skipped Codex CLI registration because --skip-codex-add was set.");
  printManualCommands();
  process.exit(0);
}

if (args.dryRun) {
  log(`Would run: codex plugin marketplace add ${shellQuote(marketplaceRoot)}`);
  log(`Would run: codex plugin add ${pluginName}@${marketplaceName}`);
  process.exit(0);
}

runCodexCommand(["plugin", "marketplace", "add", marketplaceRoot], {
  continueOnAlreadyConfigured: true,
});
runCodexCommand(["plugin", "add", `${pluginName}@${marketplaceName}`]);

log("Installed xft-comat into Codex. Start a new Codex thread to load the plugin.");

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
      fail(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(rawArgs, index, flag) {
  const value = rawArgs[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${flag}.`);
  }
  return value;
}

function printHelp() {
  console.log(`Install xft-comat into Codex from local files.

Usage:
  node scripts/install-codex-offline.mjs [options]

Options:
  --dry-run                  Print planned actions without writing files.
  --skip-codex-add           Stage files and marketplace JSON, but do not run codex commands.
  --marketplace-root <path>  Local marketplace root. Default: ${DEFAULT_MARKETPLACE_ROOT}
  --marketplace-name <name>  Marketplace name. Default: ${DEFAULT_MARKETPLACE_NAME}
  -h, --help                 Show this help.
`);
}

function stagePlugin() {
  if (isSubpath(stagedPluginDir, PLUGIN_ROOT) || path.resolve(stagedPluginDir) === PLUGIN_ROOT) {
    fail("Refusing to stage the plugin inside the source plugin directory.");
  }
  rmSync(stagedPluginDir, { force: true, recursive: true });
  mkdirSync(stagedPluginDir, { recursive: true });
  for (const entry of [
    ".codex-plugin",
    ".claude-plugin",
    "agents",
    "docs",
    "skills",
    "scripts",
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
  log("Staged plugin files.");
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
      `Marketplace already exists with name "${marketplace.name}". ` +
        `Use --marketplace-name ${marketplace.name} or choose a different --marketplace-root.`,
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
  log(`Wrote marketplace: ${marketplacePath}`);
}

function runCodexCommand(commandArgs, options = {}) {
  const printable = `codex ${commandArgs.map(shellQuote).join(" ")}`;
  log(`Running: ${printable}`);
  const result = spawnSync("codex", commandArgs, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(`Unable to run "${printable}": ${result.error.message}`);
    printManualCommands();
    process.exit(1);
  }

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    if (
      options.continueOnAlreadyConfigured &&
      /already|exists|configured|duplicate/i.test(output)
    ) {
      log("Marketplace appears to be already configured; continuing.");
      return;
    }
    console.error(output || `Command failed with exit code ${result.status}.`);
    printManualCommands();
    process.exit(result.status || 1);
  }
  if (output) {
    console.log(output);
  }
}

function printManualCommands() {
  console.log(`
Manual offline install commands:
  codex plugin marketplace add ${shellQuote(marketplaceRoot)}
  codex plugin add ${pluginName}@${marketplaceName}
`);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    fail(`Unable to read JSON from ${filePath}: ${error.message}`);
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
