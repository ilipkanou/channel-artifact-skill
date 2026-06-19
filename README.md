# channel-artifact-skill

A Claude Code skill that scaffolds **interactive HTML artifacts you can pin comments on** — and a live Claude session answers and edits the artifact in place.

You open a localhost page (a dashboard, outline, kanban, graph, anything), drop a pin or select some text, and your comment push-delivers to a Claude Code session over a **development channel**. Claude reads it, optionally edits the underlying data, and replies — the page updates live over WebSocket.

```text
[Browser] ←─ HTTP + WebSocket ─→ [Bun server] ←─ stdio MCP ─→ [Claude Code session]
   pin a comment ───────────────────→ notifications/claude/channel ──→ Claude
   page updates live ←── WebSocket ←── data.json / comments.json ←── tool calls
```

## What you get out of the box

- **Point + area pins** — click for a point pin; **select text** for an area pin that highlights the range and sends the *exact quote* to Claude.
- **Comment threads** — follow up on any pin; replies thread under the original and continue the conversation with Claude.
- **Two-way chat** — a docked chat panel where Claude reaches you proactively (questions, heads-ups, confirmations) via `post_message`, not only under a pin.
- **Save & batch-submit pins** — park pins as drafts while you review, then send them individually or all at once with **Submit all**.
- **Markdown-rendered replies**, a **pin sidebar** (numbered status badges that match the on-page markers, thread counts, **Download JSON**), and graceful render-error handling.
- **Generic `update_node`** — Claude patches any node in `data.json` by `id`, no per-shape wiring.

You implement one function (`renderArtifactInner`) and your `data.json` shape; the whole comment layer is done.

## Requirements

- **[Bun](https://bun.sh)** (`brew install oven-sh/bun/bun`) — the server runs on Bun, no build step.
- **Claude Code** with development-channel support (the `--dangerously-load-development-channels` flag and the `claude/channel` MCP capability).

## Use it

**As a skill:** drop this folder into your Claude Code skills directory and ask Claude to "build an interactive artifact / channel plugin for X". `SKILL.md` drives the scaffold.

**Manually:** copy `assets/*.template` into a plugin dir, replace `__PLUGIN_NAME__` / `__PLUGIN_NAME_UPPER__` / `__PORT__` / `__TITLE__` / `__DESCRIPTION__`, `bun install`, then launch a **new** session:

```bash
claude --dangerously-load-development-channels server:<plugin-name> --dangerously-skip-permissions
```

Open the `http://localhost:<port>` it prints, toggle **Pin mode**, and start commenting. See `SKILL.md` for the full walk-through and `references/` for architecture + troubleshooting.

## Layout

```text
SKILL.md                      # how Claude scaffolds an artifact
assets/*.template             # server.ts, index.html, package.json, .mcp.json, data.json,
                              #   comments.json, chat.json, plugin.json, hooks.json, start.sh, stop.sh
references/architecture.md    # why the pattern is shaped this way
references/building-the-viz.md # library-by-shape picks + three worked walk-throughs
references/troubleshooting.md  # every gotcha, with one-line fixes
test/lifecycle.test.ts        # bun test suite — real scaffold + lifecycle + chat/save-submit checks
scripts/setup.sh              # checks for Bun and installs it if missing
```

## Origin

Extracted and hardened from a real build (an interactive keynote-outline review tool). The comment layer — markdown rendering, threads, sidebar, point+area selection — was battle-tested there before being genericized back into this skill.
