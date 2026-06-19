# Channel artifact — architecture

Deeper notes on *why* the pattern is shaped this way, and where it's reasonable to deviate.

## Plumbing diagram

```
[Browser]  ←──── HTTP + WebSocket ────→  [Bun server]  ←─── stdio MCP ───→  [Claude Code session]
   ↑                                          │                                     │
   │                                          │ notifications/claude/channel        │
   │                                          ├─── (push: comment + meta) ─────────→│
   │                                          │                                     │
   │                                          │←─── tool calls (mark_addressed,     │
   │                                          │     update_node, update_data) ──────│
   │                                          ↓
   │                                  [data.json + comments.json on disk]
   │                                          │
   └────── live refresh via WebSocket ────────┘
```

This plumbing is domain-agnostic. The only parts that change per artifact:
1. **`data.json` shape** — whatever structure your viz needs.
2. **The `render` function in `index.html`** — how to paint `DATA` into the DOM.
3. **Which tools the MCP server exposes** — `mark_addressed` is always there; `update_node` / `update_data` are optional.
4. **The MCP server's `instructions` field** — tell Claude how to interpret the specific comments.

## Why a channel and not polling

Two earlier designs don't work:

1. **ScheduleWakeup polling.** Have this session poll `comments.json` every ~60s and address new entries. Works for ~1 user, dies under latency, burns tokens checking an empty file, and can't push progress updates from Claude back to the user between polls.
2. **Hooks.** `UserPromptSubmit` / `PostToolUse` / `Stop` hooks can't inject new user turns from an external HTTP call — they only fire on Claude actions.

Channels are the only push-based primitive in Claude Code for external systems → live session. They're a first-class MCP feature: servers declaring `experimental: { 'claude/channel': {} }` capability can emit `notifications/claude/channel` events that Claude Code surfaces to the model as `<channel source="...">` events in the conversation. That's the round-trip.

Reference implementation: `anthropics/claude-plugins-official/external_plugins/fakechat`.

## Why the server owns BOTH MCP stdio and HTTP

One process is the simplest. Alternatives we considered:

- **Separate bun UI process + MCP shim.** UI process keeps running when Claude restarts; shim just forwards tool calls. More robust but doubles the surface area and complicates setup ("now run *two* things").
- **MCP process only, UI served elsewhere.** Means the user has to start the UI separately. Brittle.

The combined server has two failure modes we explicitly handle:

1. **Port already in use** (another instance already started, or orphan bun from a prior session). Catch `EADDRINUSE`, log `running stdio-only`, `process.stdin.resume()` to keep MCP alive. Tool calls still work — they write to shared `data.json` / `comments.json`. The browser is served by whichever instance got the port first.
2. **Process exits after Bun.serve throws.** Without Bun.serve holding the event loop, and if the MCP SDK's stdio transport doesn't keep stdin flowing, the script reaches EOF and the process dies → Claude sees "Connection closed". The `process.stdin.resume()` in the catch path prevents that.

## Why JSON files for state, not SQLite or a DB

- **Trivially inspectable.** `cat comments.json` is debugging gold.
- **Merge-friendly across instances.** Each tool call reads → modifies → writes the whole file. It's not concurrent-write-safe at the FS level, but multiple concurrent Claude sessions are rare, and conflicts are detectable by reading the file before write if you need them.
- **No migration burden.** Shape changes are just code changes.

If you ever need concurrency or scale, swap `readJson`/`writeComments` for a SQLite-backed store. The API surface (three tools + two files) doesn't change.

## Why WebSocket + polling fallback

WebSocket is the fast path (<100ms from tool call → UI refresh). But we also keep a 30s poll on `/data.json` + `/comments.json` as a safety net — if the WS dies (server restart, network hiccup), the UI still converges within 30s. No user-visible broken state.

## Why `node_id="freeform"` for anywhere-pins

The anchor model is hierarchical:
1. **Data-node pins** — user clicks an existing commentable element (funnel step, sidebar card, Sankey node). `nodeId` is the element's `data-node-id`. Claude has direct context: the node exists in `data.json`.
2. **Freeform pins** — user Pin-Mode-clicks on whitespace, chart background, legend, or any element without `data-node-id`. `nodeId = "freeform"`, `anchorNodeId` is the *nearest* `[data-node-id]` (if any, found via `element.closest("[data-node-id]")`), and `contextSnippet` is a 200-char slice of the surrounding text.

Why both: the freeform case preserves *position* (x, y) AND *semantic anchor* (nearest data node) AND *textual context*. Claude uses whichever is most informative for the question.

## Why the channel notification is ONE-WAY (server → Claude)

Claude's reply goes through tool calls (`mark_addressed`, `update_node`, `update_data`), not through a reverse channel message. This is cleaner:

- Tools have a schema — Claude's reply is structured.
- Tools hit the FS directly — the UI sees the update via WebSocket broadcast on write.
- The channel stays a "firehose of user intents" — not a bidirectional chat with persistence concerns.

## When to deviate

- **Multi-user / remote access.** This pattern assumes localhost. If you want the artifact accessible to teammates, put the bun server behind an authenticated reverse proxy and deal with session isolation. The state files become a shared DB.
- **High-frequency data.** If `data.json` mutates many times per second (live metric stream), use a pub-sub instead of file writes + broadcast. The file-write approach is fine up to ~10 writes/sec.
- **Large binary assets.** Base64 in `data.json` is a footgun. Serve assets separately and reference by URL.
- **You want the channel's replies to be user-visible in the session.** The default is that tool calls are silent mutations. If you also want Claude to *speak* when addressing each comment (e.g., a running commentary in the terminal), instruct it to do so in the MCP `instructions` field.
- **Any data shape.** The template ships a generic `nodes` renderer and an id-based `update_node`, so it's domain-neutral out of the box. For funnels, graphs, kanban, time-series, maps, scatterplots — keep the channel plumbing, swap `renderArtifactInner()` and the `data.json` shape. Only the render and the data change; the comment layer is constant.

## File-by-file rationale

| File | Purpose | Why this way |
|---|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest | Required by Claude's plugin loader |
| `.mcp.json` | MCP server registration | Template inside the plugin dir — not used here because we register via project's root `.mcp.json` for the `server:<name>` launch form |
| `package.json` | Bun dependencies | `@modelcontextprotocol/sdk` only; no bundler, Bun runs TS directly |
| `server.ts` | MCP stdio + HTTP + WS + tools | Combined to minimize moving parts |
| `index.html` | The artifact | Single file, no build step, ESM imports for d3 |
| `data.json` | Viz state | Tool-mutated; WebSocket fires on every write |
| `comments.json` | Pin threads | Same |
| `chat.json` | Claude<->user chat | Same — node-less messages; `post_message` writes here, WS broadcasts |

## The cognitive model for the user

The user's mental model should be: "I click → Claude thinks → the page updates." Not "I open a form, submit a ticket, wait." Every affordance should reinforce that:

- Pin markers stay pinned (comments persist across page loads and sessions)
- Status badge (pending → addressed) gives immediate feedback
- Claude's response renders inline, not in a separate tab
- No "refresh" button — WebSocket + polling handles updates invisibly

If you break that, you break the artifact's value.

## Lifecycle & teardown

Claude starts the server (it spawns the MCP subprocess via `.mcp.json`), and the
channel closes when that process exits. So teardown == the process exiting cleanly
and freeing the port. Five triggers reach one idempotent `shutdown()`:

1. **stdin close** — Claude closes the subprocess's stdin when the session ends. The
   MCP stdio transport already flows stdin, so `process.stdin.on("end"/"close")` fires
   on the *real pipe* close. (A named FIFO does NOT reproduce this in Bun — the tests
   drive a real `Bun.spawn` pipe.) Primary automatic path.
2. **SIGINT / SIGTERM** — Ctrl-C, or Claude/OS terminating the subprocess.
3. **POST /shutdown** — the artifact's "Done / Shut down" button.
4. **SessionEnd hook** (`hooks.json`) — harness backstop that runs `stop.sh`.
5. **`stop.sh`** — manual: by pidfile, or `--port N` to reclaim a `-9` orphan.

`shutdown()` broadcasts `server-stopping` (open tabs show a stopped banner), calls
`httpServer.stop(true)` (force-closes HTTP + WS), removes the pidfile *if it owns it*,
and exits.

### Why a PID-file (`.runtime.json`), not a blind port kill

The server writes `{ pid, port, startedAt }` on bind and deletes it on clean exit.
Teardown targets *that pid*, never "whatever is on the port". This preserves the
multi-session design: a second session that found the port taken runs stdio-only and
never bound the port, so it has no pidfile claim and is never killed by a sibling's
teardown (`ownsRuntime` guards the delete). On startup, a stale pidfile whose pid is
**dead** is reclaimed; a **live** pid is left alone (real sibling).

### Belt and suspenders

The in-server stdin handler is the primary automatic path; signals cover
Ctrl-C/terminate; the SessionEnd hook is the harness-enforced backstop; `stop.sh` is
the manual escape hatch. The one runtime unknown is whether a plugin-declared
SessionEnd hook fires under `--dangerously-load-development-channels` — verify on a
real session; if it does not, generate a project `.claude/settings.json` SessionEnd
entry instead. The stdin handler and signals cover normal session end *if Claude
closes stdin or signals on exit* (the common case); if it instead orphans the
subprocess without either, the hook is the sole guard — so confirm on a real session
which path actually fires (the `shutting down (<reason>)` log line tells you).
