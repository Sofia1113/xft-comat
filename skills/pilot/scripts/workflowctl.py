#!/usr/bin/env python3
"""轻量工作流目录维护工具。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path


ROOT = Path.cwd()
WORKFLOW_ROOT = ROOT / ".xft-comat"
SKILL_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = SKILL_ROOT / "templates"


MODE_DOCS = {
    "feature-simple": [
        "00-routing.md",
        "01-requirements.md",
        "02-design-note.md",
        "03-test-cases-round-1.md",
        "04-state.md",
        "05-tasks.md",
        "06-skill-usage.md",
    ],
    "feature-medium": [
        "00-routing.md",
        "01-requirements.md",
        "02-design.md",
        "03-test-cases-round-1.md",
        "04-state.md",
        "05-tasks.md",
        "06-skill-usage.md",
    ],
    "feature-hard": [
        "00-routing.md",
        "01-requirements.md",
        "02-design.md",
        "03-test-cases-round-1.md",
        "04-state.md",
        "05-tasks.md",
        "06-skill-usage.md",
    ],
    "bugfix": [
        "00-routing.md",
        "01-requirements.md",
        "02-reproduction.md",
        "03-root-cause.md",
        "04-test-cases-round-1.md",
        "05-state.md",
        "06-tasks.md",
        "07-skill-usage.md",
    ],
    "refactor": [
        "00-routing.md",
        "01-requirements.md",
        "02-refactor-plan.md",
        "03-safety-net.md",
        "04-test-cases-round-1.md",
        "05-state.md",
        "06-tasks.md",
        "07-skill-usage.md",
    ],
}


MODE_STAGES = {
    "feature-simple": [
        "receive",
        "explore-and-clarify",
        "final-route",
        "plan",
        "test-first",
        "implement",
        "targeted-test",
        "review",
        "fix-review-findings",
        "final-verify",
        "close",
    ],
    "feature-medium": [
        "receive",
        "explore-and-clarify",
        "final-route",
        "design",
        "user-confirm-if-needed",
        "test-plan",
        "implement",
        "baseline-test",
        "review",
        "fix-and-regression",
        "final-verify",
        "close",
    ],
    "feature-hard": [
        "receive",
        "explore-and-clarify",
        "final-route",
        "conductor-plan",
        "architect-options",
        "user-decision",
        "tdd-plan-and-tests",
        "implement",
        "baseline-test",
        "code-review",
        "fix-and-regression",
        "final-e2e-verify",
        "residual-risk",
        "close",
    ],
    "bugfix": [
        "receive",
        "explore-and-clarify",
        "final-route",
        "reproduce",
        "root-cause",
        "fix-plan",
        "regression-test-first",
        "implement-fix",
        "targeted-test",
        "review",
        "fix-review-findings",
        "regression-verify",
        "close",
    ],
    "refactor": [
        "receive",
        "explore-and-clarify",
        "final-route",
        "baseline",
        "refactor-plan",
        "safety-net",
        "safety-refactor",
        "baseline-test",
        "review",
        "fix-review-findings",
        "verify-equivalence",
        "close",
    ],
}


PLACEHOLDER_MARKERS = [
    "待补充",
    "TASK-001 — 待补充",
    "初始化后改写",
    "执行后补入证据",
]


REVIEW_BEFORE_FINAL_VERIFY = {
    "feature-simple": ("review", "final-verify"),
    "feature-medium": ("review", "final-verify"),
    "feature-hard": ("code-review", "final-e2e-verify"),
    "bugfix": ("review", "regression-verify"),
    "refactor": ("review", "verify-equivalence"),
}


# 路由不再由代码用关键词命中做硬判定。代码只提供"评判框架"，由模型读取后
# 结合任务语义自行判断任务类型与复杂度，再用判断结果调用 init --mode。
TASK_TYPES = [
    ("bugfix", "用户描述了错误、异常、失败测试、回归、线上问题或现有行为不符合预期；需先复现和根因。"),
    ("refactor", "用户强调整理结构、重命名、拆分、性能清理、复用、架构改善，且要求外部行为保持不变。"),
    ("feature-simple", "新增或改变功能，但需求清楚、单点改动、低风险（复杂度 0-2 分）。"),
    ("feature-medium", "新增或改变功能，涉及多文件或有设计取舍，但边界可控（复杂度 3-4 分）。"),
    ("feature-hard", "新增或改变功能，跨模块、高风险、需要架构方案和用户关键决策（复杂度 ≥5 分）。"),
]


# 复杂度维度仅作为模型自评的清单，不再附带关键词列表做自动匹配。
COMPLEXITY_DIMENSIONS = [
    ("requirements", "需求仍有业务规则、边界条件或验收标准不明确。"),
    ("scope", "涉及 3 个以上文件或 2 个以上模块。"),
    ("infra", "涉及 API、数据库、权限、异步任务、第三方服务、计费、数据迁移或兼容性。"),
    ("ui", "涉及 UI 流程、状态管理、可访问性或浏览器 E2E。"),
    ("decision", "需要架构取舍、方案比较或用户决策。"),
    ("risk", "失败风险高：安全、数据丢失、线上回归、跨端兼容、性能热点。"),
    ("test", "测试策略不直接，需要构造夹具、mock、浏览器或多轮验证。"),
]


SCORING_BANDS = [
    ("feature-simple", "0-2 分：单点改动，需求清楚，低风险。"),
    ("feature-medium", "3-4 分：多文件或有设计取舍，但边界可控。"),
    ("feature-hard", "≥5 分：跨模块、高风险，需要架构师 agent 和明确用户抉择。"),
]


# skills list 不硬编码任何 skill，而是扫描本机标准 skill 安装目录，
# 解析每个 SKILL.md 的 frontmatter，返回真实可用的 skill 目录。
# 是否启用、必备还是可选，由模型读取目录后结合任务语义自行判断。
# 扫描来源（按优先级，靠前者覆盖靠后者的同名 skill）：
#   1. 项目级 ./.claude/skills
#   2. 用户级 ~/.claude/skills
#   3. 已安装插件提供的 skill（依据 ~/.claude/plugins/installed_plugins.json）
SKILL_SEARCH_ROOTS = [
    (Path.cwd() / ".claude" / "skills", "project"),
    (Path.home() / ".claude" / "skills", "user"),
]

INSTALLED_PLUGINS_FILE = Path.home() / ".claude" / "plugins" / "installed_plugins.json"


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9一-鿿]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:60] or "task"


def read_template(name: str) -> str:
    path = TEMPLATE_ROOT / name
    if not path.exists():
        raise SystemExit(f"缺少模板：{path}")
    return path.read_text(encoding="utf-8")


def write_template(dest: Path, template_name: str, values: dict[str, str]) -> None:
    content = read_template(template_name)
    for key, value in values.items():
        content = content.replace("{{" + key + "}}", value)
    dest.write_text(content, encoding="utf-8")


def template_for(doc: str) -> str:
    if doc.endswith("routing.md"):
        return "routing.md"
    if doc.endswith("requirements.md"):
        return "requirements.md"
    if doc.endswith("design-note.md"):
        return "design-note.md"
    if doc.endswith("design.md"):
        return "design.md"
    if doc.endswith("reproduction.md"):
        return "reproduction.md"
    if doc.endswith("root-cause.md"):
        return "root-cause.md"
    if doc.endswith("refactor-plan.md"):
        return "refactor-plan.md"
    if doc.endswith("safety-net.md"):
        return "safety-net.md"
    if "test-cases" in doc:
        return "test-cases.md"
    if doc.endswith("state.md"):
        return "state.md"
    if doc.endswith("tasks.md"):
        return "tasks.md"
    if doc.endswith("skill-usage.md"):
        return "skill-usage.md"
    raise SystemExit(f"没有匹配的模板：{doc}")


def load_meta(task_dir: Path) -> dict:
    meta_path = task_dir / "workflow.json"
    if not meta_path.exists():
        raise SystemExit(f"缺少 workflow.json：{task_dir}")
    return json.loads(meta_path.read_text(encoding="utf-8"))


def save_meta(task_dir: Path, meta: dict) -> None:
    (task_dir / "workflow.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cmd_route(args: argparse.Namespace) -> None:
    # 代码不替模型做路由决策，只回显任务并提供评判框架。
    # 模型读取后结合任务语义判断 mode，再用判断结果调用 init --mode。
    payload = {
        "task": args.task,
        "instructions": (
            "代码不对任务做关键词匹配或自动定级。请你阅读 task，"
            "先在 task_types 中判断任务类型，再用 complexity_dimensions 逐项自评"
            "（每命中一项计 1 分），按 scoring_bands 得到 feature 的复杂度，"
            "最后用判断出的 mode 调用 init。bugfix 与 refactor 优先于复杂度评分。"
        ),
        "task_types": [{"type": name, "definition": desc} for name, desc in TASK_TYPES],
        "complexity_dimensions": [
            {"dimension": name, "criterion": desc} for name, desc in COMPLEXITY_DIMENSIONS
        ],
        "scoring_bands": [{"mode": mode, "band": desc} for mode, desc in SCORING_BANDS],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def cmd_init(args: argparse.Namespace) -> None:
    if args.mode not in MODE_DOCS:
        raise SystemExit(f"未知工作流模式：{args.mode}")
    topic = slugify(args.topic)
    task_dir = WORKFLOW_ROOT / f"{date.today().isoformat()}-{topic}"
    if task_dir.exists():
        raise SystemExit(f"任务目录已存在：{task_dir}")
    task_dir.mkdir(parents=True)
    stages = MODE_STAGES[args.mode]
    initial_stage = stages[0]
    stages_markdown = "\n".join(
        f"- [{'>' if index == 0 else ' '}] {stage} — {'in_progress' if index == 0 else 'pending'}"
        for index, stage in enumerate(stages)
    )
    values = {
        "mode": args.mode,
        "topic": topic,
        "summary": args.summary,
        "date": date.today().isoformat(),
        "current_stage": initial_stage,
        "stages_json": json.dumps(stages, ensure_ascii=False),
        "stages_markdown": stages_markdown,
        "round": "1",
        "reason": "初始测试轮次",
    }
    for doc in MODE_DOCS[args.mode]:
        write_template(task_dir / doc, template_for(doc), values)
    meta = {
        "mode": args.mode,
        "topic": topic,
        "summary": args.summary,
        "created_at": date.today().isoformat(),
        "current_stage": initial_stage,
        "stages": [{"name": stage, "status": "pending"} for stage in stages],
        "test_rounds": 1,
    }
    meta["stages"][0]["status"] = "in_progress"
    save_meta(task_dir, meta)
    print(task_dir)


def state_doc_name(task_dir: Path) -> str:
    for name in ("04-state.md", "05-state.md"):
        if (task_dir / name).exists():
            return name
    raise SystemExit("找不到状态机文件")


def rewrite_state(task_dir: Path, meta: dict) -> None:
    lines = [
        f"# 状态机：{meta['topic']}",
        "",
        f"- 工作流模式：`{meta['mode']}`",
        f"- 当前阶段：`{meta['current_stage']}`",
        "",
        "## 阶段",
    ]
    for item in meta["stages"]:
        marker = "x" if item["status"] == "completed" else " "
        if item["status"] == "in_progress":
            marker = ">"
        lines.append(f"- [{marker}] {item['name']} — {item['status']}")
    lines.append("")
    (task_dir / state_doc_name(task_dir)).write_text("\n".join(lines), encoding="utf-8")


def cmd_advance(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    meta = load_meta(task_dir)
    stage_names = [item["name"] for item in meta["stages"]]
    if args.stage not in stage_names:
        raise SystemExit(f"阶段不属于当前工作流：{args.stage}")
    for item in meta["stages"]:
        if item["name"] == args.stage:
            item["status"] = "in_progress"
        elif stage_names.index(item["name"]) < stage_names.index(args.stage):
            item["status"] = "completed"
    meta["current_stage"] = args.stage
    save_meta(task_dir, meta)
    rewrite_state(task_dir, meta)
    print(json.dumps({"current_stage": args.stage}, ensure_ascii=False))


def workflow_docs(task_dir: Path) -> list[Path]:
    return sorted(path for path in task_dir.glob("*.md") if path.is_file())


def validate_review_order(meta: dict, errors: list[str]) -> None:
    pair = REVIEW_BEFORE_FINAL_VERIFY.get(meta.get("mode"))
    if not pair:
        return
    review_stage, final_verify_stage = pair
    names = [item["name"] for item in meta.get("stages", [])]
    if review_stage not in names or final_verify_stage not in names:
        errors.append(f"状态机缺少审查或最终验证阶段：{review_stage} / {final_verify_stage}")
        return
    if names.index(review_stage) > names.index(final_verify_stage):
        errors.append(f"状态机顺序错误：{review_stage} 必须早于 {final_verify_stage}")


def validate_no_placeholders(task_dir: Path, errors: list[str]) -> None:
    for path in workflow_docs(task_dir):
        content = path.read_text(encoding="utf-8")
        for marker in PLACEHOLDER_MARKERS:
            if marker in content:
                errors.append(f"{path.name} 仍包含模板占位或未闭环标记：{marker}")


def validate_required_participation(task_dir: Path, meta: dict, errors: list[str]) -> None:
    try:
        skill_path = task_dir / skill_doc_name(task_dir)
    except SystemExit as exc:
        errors.append(str(exc))
        return
    content = skill_path.read_text(encoding="utf-8")
    usage_match = re.search(r"## 使用记录\n(?P<section>.*?)(\n## |\Z)", content, re.DOTALL)
    usage_section = usage_match.group("section") if usage_match else content
    # 只结构化解析 record-skill 生成的记录行：- `skill` — 决策 — 原因[ — 证据：…]，
    # 按决策字段精确判断，避免把说明文字里出现的 "required" 误判为记录。
    record_pattern = re.compile(r"^- `(?P<skill>[^`]+)` — (?P<decision>\S+) — (?P<rest>.+)$")
    for raw in usage_section.splitlines():
        match = record_pattern.match(raw.strip())
        if not match or match.group("decision") != "required":
            continue
        rest = match.group("rest")
        if "证据：" not in rest and "证据:" not in rest:
            errors.append(f"{skill_path.name} 的 required 记录缺少实质参与证据：{raw.strip()}")

    if meta.get("mode") == "feature-hard":
        combined = "\n".join(path.read_text(encoding="utf-8") for path in workflow_docs(task_dir))
        expected = [
            "xft-comat-conductor",
            "xft-comat-architect",
            "xft-comat-tdd-engineer",
            "xft-comat-code-reviewer",
        ]
        for agent_name in expected:
            if agent_name not in combined:
                errors.append(f"feature-hard 缺少 specialist 参与或跳过原因记录：{agent_name}")


def validate_close_ready(task_dir: Path) -> list[str]:
    meta = load_meta(task_dir)
    errors: list[str] = []
    validate_review_order(meta, errors)
    validate_no_placeholders(task_dir, errors)
    validate_required_participation(task_dir, meta, errors)
    return errors


def cmd_validate(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    errors = validate_close_ready(task_dir)
    payload = {"ok": not errors, "errors": errors}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


def cmd_close(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    errors = validate_close_ready(task_dir)
    if errors:
        print(json.dumps({"closed": False, "errors": errors}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    meta = load_meta(task_dir)
    for item in meta["stages"]:
        item["status"] = "completed"
    meta["current_stage"] = "close"
    save_meta(task_dir, meta)
    rewrite_state(task_dir, meta)
    print(json.dumps({"closed": True, "current_stage": "close"}, ensure_ascii=False))


def cmd_set_doc(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    target = task_dir / args.doc
    if not target.exists():
        raise SystemExit(f"目标文档不存在或不属于当前工作流：{target}")

    provided = [bool(args.from_file), args.content is not None, bool(args.stdin)]
    if sum(provided) != 1:
        raise SystemExit("set-doc 必须且只能提供 --from-file、--content、--stdin 之一")

    if args.from_file:
        source = Path(args.from_file)
        if not source.exists():
            raise SystemExit(f"来源文件不存在：{source}")
        shutil.copyfile(source, target)
    elif args.content is not None:
        target.write_text(args.content, encoding="utf-8")
    else:
        target.write_text(sys.stdin.read(), encoding="utf-8")
    print(target)


def parse_frontmatter(text: str) -> dict[str, str]:
    """从 SKILL.md 文本提取 YAML frontmatter 的 key: value。

    支持单行值、续行，以及块标量（``description: |`` / ``>``）。
    """
    if not text.startswith("---"):
        return {}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    fields: dict[str, str] = {}
    current: str | None = None
    block_scalar = False  # 当前键是否处于 | / > 块标量模式
    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line)
        if match and not line.startswith((" ", "\t")):
            current = match.group(1)
            value = match.group(2).strip()
            # | 或 > 开头（可带 -/+ chomping 指示符）表示块标量，值在后续缩进行。
            if re.fullmatch(r"[|>][-+]?", value):
                fields[current] = ""
                block_scalar = True
            else:
                fields[current] = value
                block_scalar = False
        elif current and line.strip():
            # 续行或块标量内容：追加到当前键。
            sep = " " if fields[current] else ""
            fields[current] = fields[current] + sep + line.strip()
    return {k: v.strip().strip("'\"") for k, v in fields.items()}


def plugin_skill_roots() -> list[tuple[Path, str]]:
    """从 installed_plugins.json 读取已安装插件，返回其 skills 目录及来源标签。

    只纳入清单中列出的已安装插件，不扫描 marketplace 里未安装的插件。
    """
    if not INSTALLED_PLUGINS_FILE.is_file():
        return []
    try:
        data = json.loads(INSTALLED_PLUGINS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    roots: list[tuple[Path, str]] = []
    seen: set[str] = set()
    for plugin_key, records in (data.get("plugins") or {}).items():
        for record in records or []:
            install_path = record.get("installPath")
            if not install_path or install_path in seen:
                continue
            seen.add(install_path)
            skills_dir = Path(install_path) / "skills"
            if skills_dir.is_dir():
                roots.append((skills_dir, f"plugin:{plugin_key}"))
    return roots


def discover_skills() -> list[dict[str, str]]:
    """扫描标准 skill 目录与已安装插件，解析 frontmatter，返回真实安装的 skill 列表。"""
    found: dict[str, dict[str, str]] = {}
    # 优先级：项目级 > 用户级 > 插件；先扫到的同名 skill 保留。
    for root, scope in [*SKILL_SEARCH_ROOTS, *plugin_skill_roots()]:
        if not root.is_dir():
            continue
        for entry in sorted(root.iterdir()):
            skill_md = entry / "SKILL.md"
            if not skill_md.is_file():
                continue
            meta = parse_frontmatter(skill_md.read_text(encoding="utf-8", errors="replace"))
            name = meta.get("name") or entry.name
            # 项目级优先：已存在则不被用户级覆盖。
            if name in found:
                continue
            found[name] = {
                "skill": name,
                "scope": scope,
                "description": meta.get("description", ""),
                "path": str(entry),
            }
    return sorted(found.values(), key=lambda item: item["skill"])


def cmd_skills_list(args: argparse.Namespace) -> None:
    skills = discover_skills()
    payload = {
        "instructions": (
            "以下是本机真实安装的 skill 目录（扫描项目级 .claude/skills、用户级 "
            "~/.claude/skills，以及 installed_plugins.json 中已安装插件提供的 skills，"
            "解析每个 SKILL.md frontmatter 得到；scope 字段标明来源，plugin:<key> 表示插件）。"
            "代码不做 skill 匹配，请你结合任务语义判断哪些 skill 与当前任务相关、"
            "各属 required 还是 optional，再用 record-skill 记录决策。涉及 UI 流程或浏览器 "
            "E2E 时，若目录中存在 agent-browser 则按 SKILL.md 约定记为 required。"
        ),
        "count": len(skills),
        "available_skills": skills,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def skill_doc_name(task_dir: Path) -> str:
    for name in ("06-skill-usage.md", "07-skill-usage.md"):
        if (task_dir / name).exists():
            return name
    raise SystemExit("找不到 skill 使用记录文件")


USAGE_HEADING = "## 使用记录"


def cmd_record_skill(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    path = task_dir / skill_doc_name(task_dir)
    evidence = f" — 证据：{args.evidence}" if args.evidence else ""
    record_line = f"- `{args.skill}` — {args.decision} — {args.reason}{evidence}"
    content = path.read_text(encoding="utf-8")
    heading_at = content.find(USAGE_HEADING)
    if heading_at == -1:
        # 找不到使用记录章节时回退到文件末尾追加，保证记录不丢失。
        content = content.rstrip("\n") + f"\n{record_line}\n"
    else:
        # 插入到「使用记录」章节末尾（下一个二级标题之前或文件末尾），
        # 这样记录始终落在 validate 扫描的章节内，与章节在文件中的位置无关。
        next_heading = content.find("\n## ", heading_at + len(USAGE_HEADING))
        section_end = len(content) if next_heading == -1 else next_heading
        before = content[:section_end].rstrip("\n")
        after = content[section_end:]
        content = f"{before}\n{record_line}\n{after}"
    path.write_text(content, encoding="utf-8")
    print(path)


def next_test_doc(task_dir: Path, round_number: int) -> Path:
    docs = sorted(task_dir.glob("*test-cases-round-*.md"))
    if not docs:
        raise SystemExit("找不到测试用例文档")
    prefix = docs[0].name.split("test-cases-round-")[0]
    return task_dir / f"{prefix}test-cases-round-{round_number}.md"


def cmd_new_test_round(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    meta = load_meta(task_dir)
    meta["test_rounds"] = int(meta.get("test_rounds", 1)) + 1
    save_meta(task_dir, meta)
    values = {
        "mode": meta["mode"],
        "topic": meta["topic"],
        "summary": meta["summary"],
        "date": date.today().isoformat(),
        "round": str(meta["test_rounds"]),
        "reason": args.reason,
    }
    path = next_test_doc(task_dir, meta["test_rounds"])
    write_template(path, "test-cases.md", values)
    print(path)


def cmd_check_test(args: argparse.Namespace) -> None:
    task_dir = Path(args.task_dir)
    path = next_test_doc(task_dir, args.round)
    if not path.exists():
        raise SystemExit(f"测试轮次不存在：{path}")
    content = path.read_text(encoding="utf-8")
    status_text = "通过" if args.status == "passed" else "未通过"
    mark = "x" if args.status == "passed" else " "
    pattern = re.compile(rf"(- \[)[ x](\] {re.escape(args.case)} .*?— )(待验证|通过|未通过)(.*)")
    replacement = rf"\g<1>{mark}\g<2>{status_text}\g<4>"
    new_content, count = pattern.subn(replacement, content)
    if count == 0:
        note = args.note or ""
        new_content += f"\n- [{'x' if args.status == 'passed' else ' '}] {args.case} — {status_text} — {note}\n"
    path.write_text(new_content, encoding="utf-8")
    print(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="维护 .xft-comat 的轻量程序入口")
    sub = parser.add_subparsers(required=True)

    route = sub.add_parser("route")
    route.add_argument("--task", required=True)
    route.set_defaults(func=cmd_route)

    init = sub.add_parser("init")
    init.add_argument("--topic", required=True)
    init.add_argument("--mode", required=True, choices=sorted(MODE_DOCS))
    init.add_argument("--summary", required=True)
    init.set_defaults(func=cmd_init)

    advance = sub.add_parser("advance")
    advance.add_argument("--task-dir", required=True)
    advance.add_argument("--stage", required=True)
    advance.set_defaults(func=cmd_advance)

    validate = sub.add_parser("validate")
    validate.add_argument("--task-dir", required=True)
    validate.set_defaults(func=cmd_validate)

    close = sub.add_parser("close")
    close.add_argument("--task-dir", required=True)
    close.set_defaults(func=cmd_close)

    set_doc = sub.add_parser("set-doc")
    set_doc.add_argument("--task-dir", required=True)
    set_doc.add_argument("--doc", required=True)
    set_doc.add_argument("--from-file")
    set_doc.add_argument("--content")
    set_doc.add_argument("--stdin", action="store_true")
    set_doc.set_defaults(func=cmd_set_doc)

    skills = sub.add_parser("skills")
    skills_sub = skills.add_subparsers(required=True)
    skills_list = skills_sub.add_parser("list")
    skills_list.set_defaults(func=cmd_skills_list)

    record_skill = sub.add_parser("record-skill")
    record_skill.add_argument("--task-dir", required=True)
    record_skill.add_argument("--skill", required=True)
    record_skill.add_argument("--decision", required=True, choices=["accepted", "declined", "required", "skipped"])
    record_skill.add_argument("--reason", required=True)
    record_skill.add_argument("--evidence", default="")
    record_skill.set_defaults(func=cmd_record_skill)

    new_round = sub.add_parser("new-test-round")
    new_round.add_argument("--task-dir", required=True)
    new_round.add_argument("--reason", required=True)
    new_round.set_defaults(func=cmd_new_test_round)

    check = sub.add_parser("check-test")
    check.add_argument("--task-dir", required=True)
    check.add_argument("--round", required=True, type=int)
    check.add_argument("--case", required=True)
    check.add_argument("--status", required=True, choices=["passed", "failed"])
    check.add_argument("--note", default="")
    check.set_defaults(func=cmd_check_test)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
