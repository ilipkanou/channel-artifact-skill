# Channel artifact — troubleshooting

Every failure mode we've hit while building this pattern, with the one-liner fix.

## Setup / launch

### `/mcp` shows `<plugin-name> · ✘ failed`

Three common causes, in order:

1. **Port already in use.** Another bun process owns the port. Check with `lsof -ti:<port>` → `kill <pid>`. Then `/mcp` reconnect.
2. **Project `.mcp.json` wasn't loaded.** The server registration is project-scoped — Claude must have been launched from the project root directory. Verify with `pwd` before `claude --dangerously-load-development-channels server:<name>`.
3. **First-time approval prompt dismissed.** Project MCPs require user approval on first run. If you hit Escape or the prompt never appeared, the server stays disabled. `/mcp` → select the server → "enable".

### `Connection closed` or `MCP error -32000` right after launch

The server process crashed. Likely causes:

- **Channel meta contains non-strings.** Numbers, nulls, booleans in the `meta` object cause Zod validation to throw in Claude's channel handler. The MCP transport closes silently after the first notification. Always `String(value)` every meta field and drop keys where value is null/undefined via spread:
  ```ts
  ...(comment.anchorNodeId ? { anchor_node_id: comment.anchorNodeId } : {}),
  ```
- **`Bun.serve` threw uncaught.** If `EADDRINUSE` isn't caught, the process exits. Wrap `Bun.serve` in try/catch; on `EADDRINUSE`, log a warning and `process.stdin.resume()` so stdio MCP stays alive.

### Pin a comment but nothing happens in Claude

The UI saved the comment but the channel notification didn't reach any session. Diagnose:

1. Check `lsof -ti:<port> | xargs ps -p` — what's the PPID?
   - **PPID = 1**: orphan bun. Started standalone (`bun server.ts`) or survived its parent. No Claude is listening on its stdio. `kill <pid>` and relaunch with `claude --dangerously-load-development-channels server:<name>`.
   - **PPID = Claude's PID**: Claude spawned it, stdio is connected. Should work. Check `/mcp` for connection status and tool list.
2. If `/mcp` shows the server healthy but pins still don't trigger, look at the channel session's terminal output — a `<channel source="<name>">` event should print when a comment arrives. If not, the notification is being sent but not delivered (rare; usually the meta-types bug).
3. If you recently edited `server.ts`: **edits don't hot-reload**. `/mcp` reconnect to respawn.

### Orphan bun stays after Claude exits

Teardown is now automatic: the server exits on stdin close (session end), on
SIGINT/SIGTERM, on the UI "Done" button (`POST /shutdown`), and via the SessionEnd
hook (`hooks.json` → `stop.sh`). It writes `.runtime.json` on bind and removes it on
exit. If something still lingers (e.g. a hard `kill -9` of the terminal), reclaim the
port with the artifact's own script — it targets the pidfile, then the port:
```bash
bash stop.sh --port <port>     # or: bun run stop  (when .runtime.json is intact)
```
A second session that finds the port taken still runs stdio-only by design; it does
not bind the port and is never killed by another session's teardown.

## UI rendering

### Sankey is blank, no errors

d3-sankey `0.12.x` UMD expects `d3.array` and `d3.shape` namespaces (d3 v4 layout). d3 v7 is flat — those namespaces don't exist, so `d3.sankey` is undefined and `renderSankey()` throws inside `render()`, silently stopping everything afterward.

Fix: use ESM imports, spread the frozen namespace before adding extras:

```html
<script type="module">
  import * as d3mod from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
  import { sankey, sankeyLinkHorizontal } from "https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/+esm";
  window.d3 = { ...d3mod, sankey, sankeyLinkHorizontal };
  window.dispatchEvent(new Event("d3-ready"));
</script>
```

Then boot your main script on the `d3-ready` event (ESM modules load after the non-module body script runs, so you need to wait for it).

### `Cannot assign to property 'sankey' of [object Module]`

ESM module namespaces are frozen. Can't do `d3.sankey = sankey`. Spread into a plain object first:
```ts
window.d3 = { ...d3mod, sankey, sankeyLinkHorizontal };
```

### `Error: missing: 0` inside d3-sankey

`.nodeId(d => d.id)` tells sankey to look up nodes by string `id`, but links use numeric indices. Switch links to string ids:
```ts
// BROKEN:
{ source: 0, target: 1, value: 100 }
// WORKING:
{ source: "landing", target: "pricing", value: 100 }
```

### Sankey rects render with no fill (invisible)

CSS variables (`var(--green)`) don't resolve as SVG attribute values — only as CSS `style` rules. Use literal hex in `.attr("fill", ...)`:
```ts
// BROKEN:
.attr("fill", "var(--green)")
// WORKING:
.attr("fill", "#16a34a")
```

### Whole page below header is blank

Usually a chain reaction: `renderSankey()` throws, and the rest of `render()` (KPIs, funnel, side events) never runs. Check DevTools console for the first error. Common culprits are the three d3-sankey issues above.

## Comments / pins

### Delete returns 404

The running bun is stale — `server.ts` was edited but the server wasn't respawned. `/mcp` reconnect, OR if an orphan is holding the port, `kill $(lsof -ti:<port>)` and reconnect.

### A request to the server fails with 403 or 415

The server's request guard (`refuseForeign()` in `server.ts`) refused it. That is how it stops other websites open in the same browser from posting comments or stopping the server.

- **415 `content-type must be application/json`**: a POST without a JSON content type. Send `headers: { "content-type": "application/json" }` and a JSON body, even `"{}"` for a POST that needs no data.
- **403 `origin not allowed`**: a POST, DELETE or WebSocket upgrade sent from a page whose origin is not `http://localhost:<port>` or `http://127.0.0.1:<port>`. Open the artifact at one of those two addresses.
- **403 `host not allowed`**: the request reached the port under another name (a hostname, `0.0.0.0`, or a reverse proxy that rewrites `Host`). Use `localhost` or `127.0.0.1`.

Fix the caller; don't loosen the guard.

### Claude responds to comments I deleted

`deliverChannel` was called on the DELETE path. It must NOT be — only adds should notify Claude. Remove the call from the `DELETE /comment/:id` branch.

### Pin drops but panel opens in the wrong place

The panel uses `position: absolute` with `left/top` computed from click coords and clamped to viewport. If it's far off, check:

- The parent has `position: relative`/`static` on `body` (it should — `body` is the offset parent for `position: absolute` at the document level).
- The click event is `e.pageX`/`e.pageY`, not `e.clientX`/`e.clientY` (pageX/Y include scroll).
- `positionPanelNear` clamps against `window.scrollY + window.innerHeight` — verify the math if you customized it.

### Comment panel bottom-right instead of near click

You still have `position: fixed; right: 24px; bottom: 24px;` from a draft version. Change to `position: absolute; z-index: 70;` and call `positionPanelNear(x, y)` from every `openPanel*` function.

### Floating pin marker is hard to click

Default size (16px) is too small. Bump to 22px with a 2px white border, and keep the delete × visible whenever the pin is `active`:
```css
.floating-pin .delete-btn { width: 22px; height: 22px; ... }
.floating-pin:hover .delete-btn,
.floating-pin.active .delete-btn { opacity: 1; }
```

## Multi-instance / state-sharing

### Two Claude sessions want the same channel — one fails

Expected. The first session to spawn bun owns the HTTP port; the second hits `EADDRINUSE`, logs `running stdio-only`, and serves tool calls against the shared `data.json` + `comments.json`. Both sessions can mark comments addressed, update nodes, etc. Only the first session's bun emits WebSocket broadcasts — the browser connected to that port only sees updates from that one. This is fine for most workflows.

### WebSocket keeps disconnecting

The server was restarted (`/mcp` reconnect or process died). The client reconnects on close with a 2s backoff — see the `connectWs()` pattern in the template. If reconnects fail continuously, the server is actually down — check `lsof -ti:<port>`.

## Useful diagnostics

```bash
# Is anything on the port?
lsof -ti:<port>

# Who owns it?
lsof -ti:<port> | xargs ps -p

# PPID = 1 → orphan. PPID = claude PID → healthy spawn.

# Check MCP process tree
pgrep -fl "bun server.ts"

# Tail server stderr (captured by Claude)
# In the channel session, look for the line:
#   <plugin-name>: http://localhost:<port>
# If you see "running stdio-only" instead, another instance owns the port.

# Force a clean reset
kill $(lsof -ti:<port>) 2>/dev/null
# Then in Claude: /mcp → reconnect
```

## Known-good launch command

From the project root (the directory with `.mcp.json`):
```bash
claude --dangerously-load-development-channels server:<plugin-name>
```

If this is the first time, approve the MCP server prompt. The new session prints `<plugin-name>: http://localhost:<port>` to stderr when the server boots. Open that URL.

To verify: `/mcp` should show `<plugin-name> · ✔ connected` with tools `mark_addressed`, `update_node`, `update_data`, `post_message`.

## Comment-layer gotchas (from building the bundled template)

### Claude's reply shows raw `**` / `` ` `` / `-` instead of formatting

`mark_addressed` sends markdown, but it must be rendered, not escaped, in the panel. The template's `renderMarkdown()` does this (escape-first, then add only safe tags). If you rewrote the comment rendering, route the response through `renderMarkdown(c.response)`, not `escapeHtml(c.response)`.

### Area (text-selection) pin captures an empty quote

Opening the panel and focusing the textarea **collapses the selection**. You must read `window.getSelection().toString()` and `range.getClientRects()` **before** opening the draft panel — capture geometry + text first, then open. Derive the anchor from `range.commonAncestorContainer` (→ nearest `[data-node-id]`), not the click target. Use `mouseup` (selection is finalized by then), and don't also run a `click` handler.

### Follow-up comment on a pin silently does nothing

The submit handler needs an `activePin` branch — without it, re-opening a pin and typing hits a dead `else`. Follow-ups post with `parentId` and **no** x/y (so they thread under the original instead of dropping a second marker).

### Area pin shows "anchor gone" after Claude edits that text

An area pin stores the exact quoted text and the `data-node-id` of the element it was selected in. On every render (a load, a WebSocket update, the 30-second refresh, a window resize) `resolveOne()` searches that element's live text for the quote with `findTextRange()` and draws the highlight where the quote now sits, so reflow does not leave the box behind. If an `update_node` edit changes or removes the quoted words, the quote is no longer found: the pin leaves the page and is listed in the sidebar as "anchor gone" (purple, dashed), with its thread kept. That is intended (Done-and-Gone), because the text the comment pointed at no longer exists. Two limits:

- If the quote appears more than once in the element, the highlight goes on the first occurrence.
- An area pin selected outside any `data-node-id` element has no element to search, so it shows as "anchor gone" from the first render. Give the elements people will quote from a `data-node-id`.

### A `renderArtifactInner` exception blanks the page

`render()` → `renderArtifact()` is wrapped in try/catch so a bad render shows a red error box instead of a blank page below the header. Keep that wrapper; if you see the error box, read its stack — it's your `renderArtifactInner`, not the plumbing.
