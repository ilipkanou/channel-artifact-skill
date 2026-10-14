# channel-artifact-skill

A Claude Code skill that builds interactive web pages you can leave comments on. Each comment goes straight to a running Claude Code session. Claude answers under the comment and can change the page while you watch.

Use it for a dashboard you want to question, an outline you are reviewing, a kanban board, a data model graph, or an image you want to ask about. The comment layer is the same for all of them. Only the code that draws your data changes.

## How it works

The skill scaffolds a small plugin folder. Its `server.ts` runs on Bun and does two jobs in one process:

- It serves the page at `http://localhost:<port>` (listening on 127.0.0.1 only) and pushes live updates over a WebSocket.
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

For a single project, clone it into `<your-project>/.claude/skills/channel-artifact-skill` instead.

## Quick start

1. Start Claude Code in your project and ask for an artifact, for example: "Build me an interactive artifact for our release checklist that I can pin comments on."
2. Claude asks a few questions first (what the page shows, where the data comes from, what you will comment on, the plugin name and folder). Then it scaffolds the plugin and writes the code that draws your data.
3. Open a new terminal and run the launcher Claude gives you:

   ```bash
   bash <plugin-folder>/start.sh
   ```

   The session you used to build the artifact cannot receive comments. `start.sh` starts a fresh Claude Code session with the channel attached.
4. Approve the MCP server prompt the first time. On macOS the browser opens `http://localhost:<port>` once the server is up.
5. Turn on Pin mode (top right), click or select something, type your comment, and press Save pin or Submit to Claude.

[USAGE.md](USAGE.md) covers every step in detail, including how to build an artifact by hand without the skill.

## Limitations and safety

- `start.sh` launches Claude Code with `--dangerously-skip-permissions`, so tool calls run without approval prompts. Delete that flag from `start.sh` if you want to approve each call.
- The local server has no authentication and does not check where a request comes from. It listens on 127.0.0.1 only, but any program on your machine can post a comment, and that comment is forwarded to Claude. A web page open in your browser may be able to do the same with a plain form-style POST, and to stop the server through `/shutdown`. Treat incoming comments as untrusted input, especially while skip-permissions is on.
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
