---
name: channel-artifact-skill
description: Build ANY interactive HTML artifact backed by a Claude Code channel plugin. The user gets a localhost UI where they can pin comments anywhere on the page or on specific data points; each pin push-delivers to the live Claude session as a channel notification; Claude addresses the question (queries MCPs, runs code, etc.) and updates the artifact in place via tool calls. Use this skill whenever the user wants an interactive visualization, dashboard, explorer, annotation tool, design canvas, data tool, or ANY UI they can "poke at and have Claude answer". Trigger on phrases like "interactive artifact", "pin comments", "channel plugin", "Figma-style comments on data", "annotations that Claude responds to", "build me a dashboard with feedback", "dashboard I can chat with", "tool I can leave notes on", "make an artifact that updates when I ask it questions", "interactive thing backed by a channel", or any reference to the fakechat plugin pattern. This is the right skill any time the user wants more than a one-shot answer — they want a persistent visual artifact they can interrogate over time. The plumbing (MCP stdio + HTTP + WebSocket + channel notifications + tool calls) is fully generic — funnel dashboards, graph editors, kanban boards, sequencers, map annotators, scatterplot explorers, anything at all. Don't reach for this for static charts or one-off plots.
---

# Channel artifact

Build any interactive HTML artifact served at `localhost:<PORT>` by a Bun-backed MCP channel plugin. The user pins comments on specific nodes OR anywhere on the page — or chats with Claude in a side dock that isn't tied to any node; each pin/message push-delivers to the live Claude session as a `notifications/claude/channel` event; Claude addresses it and calls back via tool calls to update the artifact in place. Comments persist; addressed comments stay pinned with Claude's reply rendered beneath them; the UI updates live over WebSocket.

## Outcome

A runnable **Bun-backed MCP "channel" plugin** scaffolded into a folder the user launches in a fresh Claude Code session. It serves an interactive HTML artifact at `http://localhost:<PORT>` where the user pins comments (point / area / freeform), saves drafts and batch-submits them, and chats with Claude in a docked side panel; Claude answers and edits the artifact live via MCP tool calls (`mark_addressed`, `update_node`, `update_data`, `post_message`).

**Where it lands:** a folder the user chooses — `./<plugin-name>/` inside the project they're working in for a one-off artifact, or `~/tools/<plugin-name>/` for a reusable, user-level tool. Either way it's a self-contained directory; everything the plugin needs lives inside it.

**Files produced:** `.claude-plugin/plugin.json`, `.mcp.json`, `package.json`, `server.ts`, `index.html`, `data.json`, `comments.json`, `chat.json`, `start.sh`, `stop.sh`, `hooks.json`. This is an infrastructure skill — it scaffolds a working tool, not a document.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `references/architecture.md` | On demand (Step 1) | Data-flow diagram, rationale, lifecycle & teardown |
| `references/building-the-viz.md` | On demand (Step 3) | Library-by-shape table + three worked walk-throughs |
| `references/troubleshooting.md` | On demand (when something breaks) | Every failure mode hit while building this, with one-line fixes |

This skill is domain-agnostic — the user's interview answers shape each build.

## Dependencies

| Dependency | Required? | Provides | Without it |
|---|---|---|---|
| **Bun** (`brew install oven-sh/bun/bun`) | Required | Runtime for the channel server (`server.ts`); runs TS directly, no build step | Skill can't run — run `scripts/setup.sh` to install |
| **Claude Code dev-channel support** (`--dangerously-load-development-channels` + `claude/channel` capability) | Required | Push delivery of pins to the live session | Pins never reach Claude; verified present in Claude Code 2.1.133+ |

`scripts/setup.sh` checks for Bun and installs it via Homebrew if missing. No API keys or `.env` entries — the artifact runs entirely locally.

## What the bundled template already does (don't rebuild these)

`assets/index.html.template` + `server.ts.template` ship a complete, debugged comment layer. You normally only write `renderArtifactInner()` and your `data.json` shape. Already built in:

- **Point + area pins.** In Pin mode, a click drops a point pin on the nearest `data-node-id`; selecting text drops an *area* pin that highlights the exact range and sends the **exact quoted text** to Claude (`comment_type="area"`, quote in `context_snippet`).
- **Comment threads.** Re-open any pin to add follow-ups; they thread under the original via `parent_id` and push to Claude as a continuation. Newest-on-top; the open thread refreshes live without wiping what you're typing.
- **Two-way chat panel.** A docked chat (bottom-left, collapsible) for conversation *not* tied to a pin. Claude reaches the user proactively with the `post_message` tool — clarifying questions, tradeoffs, confirmations, heads-ups — instead of narrating to a terminal the user isn't watching; a new Claude message bumps + auto-opens the dock and shows an unread badge. User messages route over the channel with `chat_id="chat"` and no `node_id`. State lives in `chat.json`.
- **Markdown replies.** Claude's `mark_addressed` text is rendered (bold/lists/code/links) by a tiny dependency-free renderer that escapes first (no injection).
- **Pin sidebar.** A right-hand list of every pin — numbered status badge (matching the on-page marker), thread count, and a **Download JSON** button for the whole comment set.
- **Save vs. submit pins + batch.** Any pin can be **saved as a draft** (a third, slate-colored state — persisted but *not* sent) and submitted later: one at a time, or all at once via **Submit all (N)** in the sidebar. A reviewer can triage the whole artifact first, then send one considered batch instead of Claude reacting to each half-formed pin. `POST /comment {submit:false}` saves a draft; `POST /submit {ids?}` delivers (no `ids` = all saved).
- **Graceful failure.** `renderArtifact` is wrapped (a render bug shows an error box, not a blank page); channel meta is all-strings (the silent-transport killer is handled).

`update_node` does a **generic id lookup** — it patches whatever object in `data.json` has a matching `id`, anywhere in the structure. No per-shape wiring needed.

## Step 0: Interview the user first

Before scaffolding anything, ASK. This skill is domain-agnostic — the user's intent shapes everything downstream. Cover these with short, targeted questions:

- **What does the artifact show?** Dashboard with funnel data? Graph/network editor? Kanban board? Timeline? Map? Image annotator? Custom data viz?
- **Where does the data come from?** An MCP server (PostHog, Stripe, GitHub, Linear, Notion, etc.)? A local file? Generated on the fly? None yet (blank canvas)?
- **What are the "nodes" the user will comment on?** A funnel step? A graph vertex? A kanban card? A region of an image? Freeform anywhere on the page is always enabled — this is about *named* anchors.
- **What does Claude do when a comment arrives?** Query more data? Modify the artifact (e.g., rearrange nodes, add a new section)? Write a natural-language reply? All of the above?
- **Where should the plugin live?** Default: `./<plugin-name>/` inside the project the user is working in. Alternatives: `~/tools/<plugin-name>/` for a reusable user-level tool, or inside an existing repo. Either way it's a self-contained directory.
- **What's the plugin name?** Kebab-case, becomes the MCP server name and the channel source.
- **Any sensitive data to redact?** Revenue, PII, API keys — the UI should show them blurred (`class="redacted"`) or not at all.

Don't proceed until you have answers. If the user says "just vibe with me and build something simple", pick sensible defaults and call them out explicitly.

## Step 1: Architecture (the generic plumbing)

The full data-flow diagram is in `references/architecture.md` (browser ⇄ HTTP/WebSocket ⇄ Bun server ⇄ stdio MCP ⇄ Claude session; tool calls mutate `data.json` / `comments.json` / `chat.json`, WebSocket refreshes the UI).

This plumbing is domain-agnostic. The only parts that change per artifact:
1. **`data.json` shape** — whatever structure your viz needs.
2. **The `render` function in `index.html`** — how to paint `DATA` into the DOM.
3. **Which tools the MCP server exposes** — `mark_addressed` and `post_message` are always there; `update_node` / `update_data` are optional.
4. **The MCP server's `instructions` field** — tell Claude how to interpret the specific comments.

## Step 2: Scaffold

Create this layout:

```
<plugin-name>/
├── .claude-plugin/plugin.json
├── hooks.json          # SessionEnd → stop.sh (teardown backstop)
├── .mcp.json
├── package.json
├── server.ts
├── stop.sh             # manual teardown / port reclaim
├── start.sh            # one-command launcher: root-resolve → launch → auto-open → teardown
├── index.html
├── data.json       # your viz state shape
├── comments.json   # { "comments": [] }
└── chat.json       # { "messages": [] }  (auto-created on first boot if missing)
```

Start from the bundled templates in `assets/`:
- `assets/plugin.json.template` → `.claude-plugin/plugin.json`
- `assets/mcp.json.template` → `.mcp.json`
- `assets/package.json.template` → `package.json`
- `assets/server.ts.template` → `server.ts`
- `assets/index.html.template` → `index.html` (minimal — has pin overlay, comment panel, chat dock, WebSocket, no viz)
- `assets/data.json.template` → `data.json`
- `assets/comments.json.template` → `comments.json`
- `assets/chat.json.template` → `chat.json`
- `assets/hooks.json.template` → `hooks.json` · `assets/stop.sh.template` → `stop.sh` · `assets/start.sh.template` → `start.sh`

Replace `__PLUGIN_NAME__`, `__PLUGIN_NAME_UPPER__`, `__PORT__`, `__TITLE__`, `__DESCRIPTION__` placeholders. Run `bun install` in the plugin directory, then `chmod +x stop.sh start.sh`.

## Step 3: Build the viz

The template `index.html` is a blank canvas with all the comment plumbing already wired. Implement `window.renderArtifact(DATA)` to paint `DATA` into `#content`. Every element that should be commentable gets `data-node-id="<your-id>"`. Elements without `data-node-id` are still commentable via freeform pins (the script auto-detects the nearest ancestor with an id as the anchor).

### Libraries worth knowing

No runtime dependencies are required — the template is vanilla JS + Bun. Pull in only what you need via ESM CDN imports (`https://cdn.jsdelivr.net/npm/<pkg>@<version>/+esm`). `references/building-the-viz.md` has a library-by-shape table (D3, Chart.js, Observable Plot, Cytoscape, Konva, Three.js, Leaflet, Tabulator, CodeMirror, etc.) plus the Tailwind-via-CDN note. Plain CSS works fine — the template ships a clean design-system.

## Step 4: Shape `data.json` for your artifact

The starter shape is a flat `nodes` array, which the bundled `renderArtifactInner()` paints out of the box:

```json
{ "title": "...", "nodes": [ { "id": "a", "label": "...", "body": "..." } ] }
```

Use whatever your viz needs (graph `{nodes,links}`, kanban `{columns:[{cards}]}`, timeline `{events}`, etc.) — `references/building-the-viz.md` has worked shapes.

No schema is enforced beyond "valid JSON object". `update_node` does a **generic lookup** — it patches whatever object has a matching `id`, found by walking every array property of `data` (one nesting level deep). So `nodes`, `columns[].cards`, `events`, etc. all work with no server changes. Only customise the lookup in `server.ts` if two nodes can share an id or you need a more specific match. The one contract: **every commentable element in `renderArtifactInner()` needs `data-node-id="<id>"` matching an object's `id`** so `update_node` can patch it.

## Step 5: Register in the project's `.mcp.json`

Add to `<project-root>/.mcp.json`:

```json
{
  "mcpServers": {
    "<plugin-name>": {
      "command": "bun",
      "args": ["run", "--cwd", "<absolute path to plugin dir>", "--silent", "start"]
    }
  }
}
```

Use the absolute path. `.mcp.json` is project-scoped — Claude loads it only when launched from the project root. The scaffolded `start.sh` auto-generates this file at the git root if it's missing (e.g. a re-created worktree, since `.mcp.json` is commonly gitignored), so you rarely write it by hand.

## Step 6: Hand off to the user

The scaffold includes a ready-to-run `start.sh`. Give the user a short block — fill in the REAL plugin-dir path, port/URL, and the REAL tools you exposed (may just be `mark_addressed` + `post_message`).

```
Setup complete. ⚠️ THIS session cannot receive channel events — start.sh spawns a fresh one.

Open a NEW terminal and run:
    bash <absolute path to plugin dir>/start.sh

It resolves the project root, frees any stale port, launches a new Claude Code
session with the channel attached, and auto-opens http://localhost:<PORT> the
moment the server binds. Approve the MCP prompt the first time. Then:

  • Toggle "Pin mode: on" (top-right) — pins only drop while it's on (Esc to exit).
  • Click anywhere (or select text for an exact-quote pin) → type → Submit. The pin
    push-delivers; Claude replies via mark_addressed, the pin turns green, the reply
    renders beneath.
  • Triage first? Click "Save pin" to park a draft (slate), then "Submit all (N)" in
    the sidebar to send the whole batch at once.
  • Chat dock (bottom-left): Claude posts questions / heads-ups here, and you can
    message back without anchoring to a node. A new Claude message auto-opens it.
  • Run /mcp to verify:  <plugin-name> · ✔ connected — tools: <your-tools>
  • Done? Click "Done / Shut down", or just end the session — the port frees on exit.

Launch by hand instead:  cd <project-root> && claude --dangerously-load-development-channels server:<plugin-name>
If anything misbehaves, see references/troubleshooting.md.
```

Critical reminders to state plainly in your reply, not just inside the code block:

- **The current session cannot receive channel events.** Channel notifications only flow to the session that loaded the plugin via `--dangerously-load-development-channels`. Spawning a new terminal is not optional.
- **Tell the user the actual URL.** Include the real `http://localhost:<PORT>` (with whatever port you picked) in your reply so they can click it. Don't leave `__PORT__` placeholders.
- **Pin Mode is off by default.** First-time users will click and nothing happens; they'll think it's broken. Mention the top-right toggle explicitly.
- **`start.sh` includes `--dangerously-skip-permissions` by default** — fast iterate-in-place on a localhost-only tool. It's commented in the script; tell users they can drop the flag if they'd rather approve each tool call.
- **Teardown is automatic on session end** (also Ctrl-C, the Done button, the SessionEnd hook, and `start.sh`'s own exit trap). If a `kill -9` ever leaves the port held, run `bash stop.sh --port <PORT>`. See `references/architecture.md` → Lifecycle & teardown.

## Example walk-throughs

Three worked examples — a kanban board, a data-model graph editor, and an image annotator — are in `references/building-the-viz.md`. Each runs the full interview → scaffold → `data.json` → `renderArtifact` → tools → instructions path end-to-end.

## Files in this skill

- `assets/plugin.json.template` — `.claude-plugin/plugin.json`
- `assets/mcp.json.template` — `.mcp.json` (plugin-internal, references `${CLAUDE_PLUGIN_ROOT}`)
- `assets/package.json.template` — `package.json` with the MCP SDK dep
- `assets/server.ts.template` — Bun HTTP + WS + MCP stdio + tools (`mark_addressed`, `update_node`, `update_data`, `post_message`), the `/comment` / `/submit` / `/chat` routes, EADDRINUSE handling, and string-only channel meta
- `assets/index.html.template` — artifact scaffold: pin overlay, comment panel near click, save-vs-submit pins + sidebar batch submit, the chat dock, WebSocket, delete-without-notify. Paint your viz into `#content` via `window.renderArtifact(DATA)`.
- `assets/data.json.template` — empty shape placeholder
- `assets/comments.json.template` — `{ "comments": [] }`
- `assets/chat.json.template` — `{ "messages": [] }` (the chat panel's state; server auto-creates it if missing)
- `assets/hooks.json.template` — SessionEnd hook (runs stop.sh), referenced by plugin.json
- `assets/stop.sh.template` — manual teardown / `--port` orphan reclaim
- `assets/start.sh.template` — one-command launcher: resolves the project root (auto-generates `.mcp.json` if missing), frees a stale port, launches Claude Code with the channel + skip-permissions, auto-opens the URL on bind, frees the port on exit
- `test/lifecycle.test.ts` — `bun test` suite: scaffolds a temp instance from the templates and exercises the real lifecycle (teardown triggers, port reclaim, multi-instance), plus static + live checks for the chat and save/submit features
- `references/troubleshooting.md` — every gotcha we've hit, with one-liner fixes
- `references/architecture.md` — the plumbing diagram + deeper rationale (why channels > polling, why stdio+HTTP in one process, when to deviate)
- `references/building-the-viz.md` — library-by-shape picks + three worked walk-throughs
- `scripts/setup.sh` — checks for Bun and installs it via Homebrew if missing

## Rules

Hard constraints, read before every build. Violating any of these breaks the artifact in a way that is painful to diagnose later.

- 2026-06-19: **Channel meta must be `Record<string, string>`.** Numbers / nulls / booleans make Zod throw in Claude's channel handler and the MCP transport closes *silently* after the first notification. Always `String()` every meta value and drop nullish keys via spread. This is the #1 silent-failure mode.
- 2026-06-19: **The scaffolding session cannot receive channel events.** Only the session launched with `--dangerously-load-development-channels` does. Always hand off a fresh `start.sh` / new-session launch; never imply the current session will answer pins.
- 2026-06-19: **`DELETE /comment` must never call `deliverChannel`.** Otherwise Claude wastes turns answering comments the user already removed.
- 2026-06-19: **Don't rebuild the comment layer.** Pins, threads, the chat dock, save/batch submit, the sidebar, and markdown rendering ship debugged in the template. You write `renderArtifactInner()` + the `data.json` shape (and optionally extra tools) — nothing else.
- 2026-06-19: **For a slide-deck review, clone a proven instance** rather than scaffold fresh; render each slide as a thumbnail node, and after any change regenerate ALL affected thumbnails and cache-bust the `<img>` via an `update_node` query bump (`?v=N`) — `cache-control: no-store` does not refresh an already-rendered image.

## Self-Update

If the user flags an issue during a build — a wrong scaffold step, a bad default, a gotcha that bit them, an incorrect tone in the hand-off — update the `## Rules` section in this `SKILL.md` immediately with a dated correction so the next build doesn't repeat the mistake. After a real review session, fold any concrete fixes you had to make back into the templates and these Rules. (Rules are hard constraints read before every run.)

## Troubleshooting

Quick hits below; `references/troubleshooting.md` has the full diagnoses for every failure mode (setup/launch, UI rendering, comments/pins, multi-instance).

- **Channel meta must be `Record<string, string>`.** Numbers, nulls, booleans → Zod throws → MCP transport closes silently. Always `String()` everything and drop null/undefined keys via spread.
- **Bun.serve EADDRINUSE.** Wrap in try/catch; on `EADDRINUSE`, log "running stdio-only" and `process.stdin.resume()`. Don't crash — multiple Claude sessions can share state files.
- **Orphan bun on port.** If you ran `bun server.ts` standalone, killing the parent doesn't kill it. `lsof -ti:<port> | xargs kill` to free, or `bash stop.sh --port <port>`.
- **Edits to `server.ts` don't hot-reload.** After editing, `/mcp` reconnect in the channel session — or kill the bun process and Claude respawns.
- **DELETE comment must NOT call deliverChannel.** Otherwise Claude wastes turns answering removed comments.
- **Pinned/chatted but nothing reaches Claude.** Usually the meta-types bug above, or the bun is an orphan (PPID 1) with no Claude on its stdio. See `references/troubleshooting.md` → "Pin a comment but nothing happens in Claude".
