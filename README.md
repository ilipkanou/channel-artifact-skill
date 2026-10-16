# channel-artifact-skill

A Claude Code skill that builds interactive web pages you can leave comments on. Each comment goes straight to a running Claude Code session. Claude answers under the comment and can change the page while you watch.

Use it for a dashboard you want to question, an outline you are reviewing, a kanban board, a data model graph, or an image you want to ask about. The comment layer is the same for all of them. Only the code that draws your data changes.

## Real-world use

The comment layer was first built to review comic-style carousel posts for the MAGIC Quick Wins Instagram and Facebook pages. Each review page showed one series of posts, panel by panel. The reviewer dragged a box over the part of a panel that was wrong and wrote what to change. Claude, in the session attached to the page, fixed the panel image and answered under the pin. Three review sessions in June and July 2026 produced 72 comments on 15 posts. Claude answered all 72 on the page, and 56 of them were boxes drawn on an image. The five posts reviewed on July 14 and 15, 2026 went live on July 15 to 19.

## How it works

The skill scaffolds a small plugin folder. Its `server.ts` runs on Bun and does two jobs in one process:

- It serves the page at `http://localhost:<port>` (listening on 127.0.0.1 only) and pushes live updates over a WebSocket. It refuses requests from other websites open in your browser (see [Limitations and safety](#limitations-and-safety)).
- It is an MCP server that Claude Code starts over stdio. It declares the `claude/channel` capability, so it can push events into the session.

```text
Browser  <-- HTTP + WebSocket -->  Bun server (server.ts)  <-- stdio MCP -->  Claude Code session

1. You pin a comment        ->  POST /comment  ->  notifications/claude/channel  ->  Claude
2. Claude replies or edits  ->  MCP tool call  ->  data.json / comments.json / chat.json
3. The page refreshes       <-  WebSocket broadcast
```

Claude gets four MCP tools:

| Tool | What it does |
|---|---|
| `mark_addressed(comment_id, response)` | Marks a pin as answered and shows the reply under it. Markdown is rendered. |
| `update_node(node_id, patch)` | Merges `patch` into the object in `data.json` whose `id` matches, searching the arrays in the data. |
| `update_data(data)` | Replaces the whole `data.json`. |
| `post_message(text)` | Posts to the page's chat panel, for questions or notices that are not tied to a pin. |

State lives in three JSON files next to the server: `data.json` (what the page shows), `comments.json` (pins and replies) and `chat.json` (chat messages).

## What the page can do

- Point pins: click anywhere while Pin mode is on.
- Area pins: select text. Claude receives the exact text you selected.
- Region pins: drag a rectangle over an image or card. The box is stored relative to that element, so it survives reloads and resizing.
- Threads: reopen a pin to add follow-ups. Claude receives them as a continuation.
- Drafts: save a pin or reply without sending it, then send them all with Submit all.
- Chat panel: talk to Claude without pinning anything. Claude can post there on its own, and the panel opens when it does.
- Sidebar: every pin with its number, status and thread count, plus Download JSON for all comments.
- Pins re-anchor to the live page on every render. If the element a pin pointed at is gone, the pin moves to the sidebar marked "anchor gone", and its thread is kept.
- A Done / Shut down button stops the server and frees the port.

## Requirements

- Claude Code with development channel support: the `--dangerously-load-development-channels` flag and the `claude/channel` capability. The skill's notes record this as verified on Claude Code 2.1.133 and later.
- [Bun](https://bun.sh). `scripts/setup.sh` installs it if it is missing (Homebrew on macOS, otherwise the official install script through curl). The test suite passes on Bun 1.3.14 on macOS.
- `bash` and `lsof`. The launcher also uses `git` to find your project root when no `.mcp.json` registers the plugin yet, and `curl` if it is present. It opens the browser with the macOS `open` command; on other systems, open the printed URL yourself.
- Network access when a plugin is first installed, so `bun install` can fetch `@modelcontextprotocol/sdk` from npm.

No API keys or `.env` file are needed. Everything runs on your machine.

## Install

Clone it into your personal skills folder so it is available in every project:

```bash
git clone https://github.com/ilipkanou/channel-artifact-skill.git ~/.claude/skills/channel-artifact-skill
bash ~/.claude/skills/channel-artifact-skill/scripts/setup.sh
```

The second line checks for Bun and installs it if it is missing.

For a single project, clone it into `<your-project>/.claude/skills/channel-artifact-skill` instead.

## Quick start

Each step says what it does and gives the line to copy or type.

1. **Ask Claude for an interactive or channel artifact.** Start Claude Code in your project and describe the page you want, for example:

   ```text
   Build me an interactive artifact for our release checklist that I can pin comments on.
   ```

   Claude asks a few questions first: what the page shows, where the data comes from, what you will comment on, and the plugin name and folder. Then it scaffolds the plugin, runs `bun install` and writes the code that draws your data.

2. **Launch it in a new terminal.** The session that built the artifact cannot receive comments, so `start.sh` starts a fresh Claude Code session with the channel attached. Use the folder Claude gives you:

   ```bash
   bash <plugin-folder>/start.sh
   ```

3. **Approve and check the connection.** Approve the MCP server prompt the first time. Claude Code then asks for approval before tool calls, as it normally does. Type this in the new session:

   ```text
   /mcp
   ```

   The plugin should show as connected, with the tools `mark_addressed`, `update_node`, `update_data` and `post_message`. On macOS the browser opens `http://localhost:<port>` once the server is up; elsewhere, open the URL that `start.sh` prints.

4. **Pin your first comment.** Turn on Pin mode (top right), click or select something, type your comment, and press Submit to Claude. When Claude answers, the pin turns green and the reply appears under your comment.

5. **Close it when you are done.** Press Done / Shut down on the page and confirm. Then end the Claude Code session: type `/exit`, or press Ctrl-C in its terminal. The section below explains what closes and what stays.

[USAGE.md](USAGE.md) covers every step in detail, including how to build an artifact by hand without the skill.

### Using it day to day

- **Collect, then send.** Press Save pin to keep a comment as a draft. Send all drafts at once with Submit all in the sidebar, and Claude answers each one.
- **Read the answer under the pin.** When a comment asks for a change, Claude edits the page's data and the page redraws while you watch. Reopen a pin to add a follow-up.
- **Talk without a pin.** Use the chat panel at the bottom left for questions that are not about one spot.
- **Keep a record.** Download JSON in the sidebar saves every comment and reply.

### When you are done: how it closes

- **What closes it.** The Done / Shut down button (after you confirm), ending the Claude Code session, or Ctrl-C in its terminal. All three reach the same shutdown in `server.ts`.
- **What happens.** The server tells open tabs it is stopping, and they show "Server stopped" with "The channel is closed and the port is freed. Safe to close this tab." It closes the web page and its live connection, deletes `.runtime.json` (the file that records its process ID and port), and exits. That process is also the MCP server, so the channel to Claude closes with it.
- **Extra steps that free the port.** If you launched with `start.sh`, it runs `stop.sh` once more when the Claude Code session ends, so the port is free. The plugin also asks Claude Code to run `stop.sh` at session end (a SessionEnd hook); whether that hook fires for a development channel is not confirmed yet.
- **If a port stays busy.** Run `bash <plugin-folder>/stop.sh`. It stops the process named in `.runtime.json` and checks the port. With no `.runtime.json`, name the port: `bash <plugin-folder>/stop.sh --port <port>`. It reports that the port is free, or warns if something still holds it.
- **What stays.** The plugin folder, with `data.json`, `comments.json` and `chat.json`, and the plugin's entry in your project's `.mcp.json`. So `bash <plugin-folder>/start.sh` brings the same page back next time.
- **To remove an artifact for good.** After it has stopped, delete its entry from the project's `.mcp.json`, then delete the plugin folder.

## Limitations and safety

- `start.sh` keeps Claude Code's permission prompts on. To turn them off, run `CHANNEL_ARTIFACT_SKIP_PERMISSIONS=1 bash <plugin-folder>/start.sh`, which adds `--dangerously-skip-permissions`. Then every tool call Claude makes while answering a comment runs without asking you, shell commands and file edits included. Only do this in a project where you accept that.
- The local server listens on 127.0.0.1 only and has no login. It refuses requests from other websites open in your browser. A request must name `localhost:<port>` or `127.0.0.1:<port>` as its host, which blocks a trick called DNS rebinding. A POST, DELETE or WebSocket connection sent from another site's page is refused. A POST must have the content type `application/json`, which a plain HTML form cannot send. So another site cannot post a comment, delete one, or stop the server.
- Any program already running on your machine can still post a comment, and that comment is forwarded to Claude. Treat comments as untrusted input, especially with permission prompts turned off.
- State is plain JSON files, read and rewritten whole on each change. That works for one person, not for heavy concurrent writes.
- If two sessions load the same plugin, the first one owns the port. The second runs without the web server, and its changes reach the page only through the page's 30-second refresh.
- Changes to `server.ts` take effect only after the MCP server restarts (`/mcp`, then reconnect, in the channel session).
- The plugin declares a SessionEnd hook that runs `stop.sh`. Whether that hook fires for a development channel has not been confirmed. The server also shuts down when Claude closes its input or sends it a signal, and `bash stop.sh --port <port>` frees a stuck port.
- Only tested on macOS.

## Repository layout

```text
SKILL.md                        instructions Claude follows to build an artifact
assets/*.template               server.ts, index.html, package.json, .mcp.json, data.json,
                                comments.json, chat.json, plugin.json, hooks.json, start.sh, stop.sh
references/architecture.md      why it is built this way, lifecycle and teardown
references/building-the-viz.md  chart and UI library picks, three worked examples
references/troubleshooting.md   known failure modes and their fixes
test/lifecycle.test.ts          bun test suite for the templates
scripts/setup.sh                installs Bun if it is missing
```

Run the tests from the repository root with `bun test ./test/lifecycle.test.ts`. They scaffold a throwaway plugin in a temp folder, run `bun install` there, and use port 5197.

## Credits

The channel server follows the pattern of Anthropic's `fakechat` example plugin (`anthropics/claude-plugins-official`, `external_plugins/fakechat`, Apache License 2.0). The comment layer was first built for a review tool and then made generic.

## License

MIT. See [LICENSE](LICENSE).

Author: Igor Lipkanou
