A wide horizontal diagram with FIVE vertical swimlanes, plus a shared pre-route common-steps band on top, a shared final-route node below it, and a shared closing node at the bottom. Rendered in Anthropic Claude's official brand UI style.

STYLE (strict):
- Background: warm off-white cream (#F0EEE6).
- Accent: terracotta clay orange (#D97757) for the shared common band, the shared close node, and main flow arrows.
- Secondary: soft warm grey (#BFBAAE) thin vertical lane dividers, muted dark slate (#3D3D3A) text, gentle sand beige (#E8E4D8) card fills.
- Stage nodes: small rounded rectangles connected by downward arrows; flat minimal design, soft shadows, generous whitespace.
- Typography: modern sans-serif labels, serif display title. Calm, editorial, premium. NOT neon, NOT dark mode.

CONTENT — title "xft-comat Workflow Swimlanes (5 modes)".

TOP shared band (orange, spanning full width) labeled "Pre-route common steps (all modes)" containing two nodes left-to-right: "receive" -> "explore & clarify". Below this band, place one centered orange node labeled "final-route" with a short arrow from "explore & clarify" to it. An arrow fans down from "final-route" into all five lanes below.

FIVE vertical swimlanes side by side, each with a header label and its own top-to-bottom stage nodes:

Lane 1 header "feature-simple": plan -> test-first -> implement -> targeted-test -> review -> fix-review-findings -> final-verify

Lane 2 header "feature-medium": design -> user-confirm -> test-plan -> implement -> baseline-test -> review -> fix & regression -> final-verify

Lane 3 header "feature-hard": conductor-plan -> architect-options -> user-decision -> tdd-plan & tests -> implement -> baseline-test -> code-review -> fix & regression -> final-e2e-verify -> residual-risk

Lane 4 header "bugfix": reproduce -> root-cause -> fix-plan -> regression-test-first -> implement-fix -> targeted-test -> review -> fix-review-findings -> regression-verify

Lane 5 header "refactor": baseline -> refactor-plan -> safety-net -> safety-refactor -> baseline-test -> review -> fix-review-findings -> verify-equivalence

BOTTOM shared node (orange, spanning full width) labeled "close (all modes)". An arrow goes from the bottom of every lane down into this single shared "close" node.

In every lane, color the "review"/"code-review" node and the final verify node in orange to show the shared invariant: review always comes BEFORE final verification.

Keep all text clean English, short labels, highly legible, no gibberish. Wide 16:9 landscape orientation, five evenly spaced columns, balanced composition, plenty of negative space.
