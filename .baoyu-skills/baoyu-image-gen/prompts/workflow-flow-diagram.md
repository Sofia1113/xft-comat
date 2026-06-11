A modern minimalist workflow flow mechanism diagram (flowchart style) with dark background and bright neon colors. The diagram shows the complete flow of an AI coding workflow system from user input to task completion.

The flow is a vertical flowchart with clear stages, branching, and loops. Style: dark background (#0D1117), bright neon connecting lines, clean geometric shapes, modern tech aesthetic.

FLOW SEQUENCE (top to bottom):

STEP 1 — "User Input" (top):
- Rounded pill shape: "/pilot <task description>" (bright cyan #00E5FF glow)
- Arrow down

STEP 2 — "Phase 0: Pre-flight" (section label in gray):
- Three horizontal boxes in sequence connected by arrows:
  a) "Project Exploration" (dispatch worker-ro + explore-project skill) — blue #448AFF border
  b) "Idea Clarification" (grill-idea skill, one question at a time) — orange #FF6D00 border
  c) "Workflow Routing" (workflow-router: type → complexity → mode) — purple #BB86FC border

STEP 3 — "Phase 1: Initialization" (section label):
- Single box: "route + init" — creates .xft-comat/YYYY-MM-DD-topic/ with templates (yellow #FFD700)
- Output icons: 00-routing.md, 01-requirements.md, tasks.md, state.md, workflow.json
- Arrow down

STEP 4 — "Phase 2: Stage Loop" (section label, LARGE central area):
- A prominent LOOP indicator (circular arrow icon, bright green #00FF87)
- Inside the loop area, show this cycle:

  a) "workflowctl.ts next --task-dir" → returns Dispatch Packet (box with items: stage, agent variant, skill_paths, inputs, outputs, quality_gate)
     Arrow to:
  b) DECISION DIAMOND: "dispatch.kind?" (bright yellow diamond shape)
     - Branch A (labeled "agent"): → "Dispatch Worker" (green #00FF87)
       - Sub-branch A1: "worker (RW)" for implement/fix
       - Sub-branch A2: "worker-ro (RO)" for investigate/plan/review/final-verify
       - Worker reads SKILL.md → executes methodology → self-records via submit/set-doc
     - Branch B (labeled "main"): → "Pilot Handles Directly" (blue #448AFF)
       - For decide: AskUserQuestion for design decisions
       - For close: validate gates → close workflow
     Both branches converge to:
  c) "workflowctl.ts advance --stage <next>" → increments state machine
     Arrow loops back to (a)

- Below the loop, show a small parallel/concurrent indicator:
  "When pending_tasks >= 2: split into dependency waves, parallel dispatch per wave"
  (small icon of multiple parallel arrows)

STEP 5 — "Phase 3: Termination" (section label):
- "next returns done: true" (bright pink #FF4081)
- Arrow to:
- "validate" (check all quality gates: review order, stage traversal, placeholder sentinels, task completion, etc.)
- DECISION DIAMOND: "Pass?"
  - YES → "close" → "Done ✓" (green checkmark)
  - NO → arrow loops back to Phase 2 (route to failing worker)

STEP 6 — "Output" (bottom):
- Folder icon: ".xft-comat/YYYY-MM-DD-topic/" containing all artifacts (pink glow)
- List of artifacts as small pills: routing, requirements, design, tasks, review, implementation records, test results

VISUAL STYLE:
- Dark background (#0D1117) with subtle dot grid
- All boxes have rounded corners, dark fill, bright colored borders (neon glow effect)
- Connecting lines: bright cyan (#00E5FF) for main flow, yellow (#FFD700) for dispatch, purple (#BB86FC) for data
- Arrowheads on all directional connections
- LOOP indicator: prominent circular arrow in bright green
- Decision diamonds: bright yellow with sharp corners
- Clean sans-serif white text
- Icons: simple geometric shapes (circles, diamonds, arrows)
- No photographic elements, pure diagram/vector style
- Flat design, neon glow borders

ASPECT RATIO: 16:9, vertical flow orientation.
