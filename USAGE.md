# Usage

Step by step: install the skill, have Claude build an artifact, launch it, use the page, stop it, customize it, or build one by hand. [README.md](README.md) has the overview.

## 1. Install

```bash
git clone https://github.com/ilipkanou/channel-artifact-skill.git ~/.claude/skills/channel-artifact-skill
bash ~/.claude/skills/channel-artifact-skill/scripts/setup.sh
```

`setup.sh` prints the Bun version if Bun is already installed. If it is not, the script installs Bun with Homebrew on macOS, or with the official install script (`curl -fsSL https://bun.sh/install | bash`) elsewhere.

To use the skill in one project only, clone it into `<your-project>/.claude/skills/channel-artifact-skill` instead.

## 2. Ask Claude to build an artifact

In a Claude Code session inside your project, describe what you want. Phrases like "interactive artifact", "pin comments", "dashboard I can chat with" or "channel plugin" bring in the skill. For example:

> Build me an interactive artifact that shows our open issues as a kanban board I can pin comments on.

Claude asks before it builds anything:

- what the page shows, and where the data comes from (an MCP server, a local file, or nothing yet)
- which things on the page you want to comment on
- what Claude should do when a comment arrives
- the plugin name, in kebab-case (for example `issue-board`), and where the folder goes (default `./<plugin-name>/` in your project, or `~/tools/<plugin-name>/`)
- whether anything sensitive should be blurred or left out

Then it creates the plugin folder:

```text
<plugin-name>/
  .claude-plugin/plugin.json
  .mcp.json           plugin-internal registration (uses ${CLAUDE_PLUGIN_ROOT})
  hooks.json          SessionEnd hook that runs stop.sh
  package.json
  server.ts           web server, MCP server and tools
  index.html          the page, with the whole comment layer built in
  data.json           what the page shows
  comments.json       pins and replies
  chat.json           chat messages (created on first start if missing)
  start.sh            one-command launcher
  stop.sh             teardown and port cleanup
```

It runs `bun install` in that folder, writes the `renderArtifactInner()` function in `index.html` that draws your data, shapes `data.json`, and describes your data in the server's instructions to Claude. It finishes with a hand-off message that has the real folder path and URL.

## 3. Launch

Open a new terminal and run:

```bash
bash <plugin-folder>/start.sh
```

Use a new terminal because the session that built the artifact cannot receive comments. Only a session started with `--dangerously-load-development-channels` gets them.

`start.sh` does this, in order:

1. Finds the project root: the nearest folder above the plugin folder with a `.mcp.json` that registers the plugin. If there is none, it writes a `.mcp.json` at the git root. If a `.mcp.json` already exists there without the plugin, it stops and prints the entry to add, rather than overwrite the file.
2. Checks that `bun` and `claude` are on your PATH, and frees the port if an old server still holds it.
3. Starts Claude Code from the project root:

   ```bash
   claude --dangerously-load-development-channels server:<plugin-name>
   ```

   It adds `--dangerously-skip-permissions` only if you ask for it (see below).
4. Waits up to about 45 seconds for the server, then prints the URL and, on macOS, opens it.
5. Frees the port again when the session ends.

The first time, Claude Code asks you to approve the project's MCP server. To check the connection, run `/mcp` in the new session. The plugin should show as connected, with the tools `mark_addressed`, `update_node`, `update_data` and `post_message`.

Claude Code asks for approval before tool calls, as it normally does. To skip those prompts, launch with:

```bash
CHANNEL_ARTIFACT_SKIP_PERMISSIONS=1 bash <plugin-folder>/start.sh
```

This adds `--dangerously-skip-permissions`, and `start.sh` prints a warning when it does. Every tool call Claude makes while answering a comment then runs without asking you, shell commands and file edits included. Comments are input you do not fully control, so only do this in a project where you accept that.

To launch without the script, run this from the project root:

```bash
claude --dangerously-load-development-channels server:<plugin-name>
```

## 4. Use the page

- **Pin mode.** Pins only drop while Pin mode is on (the button at the top right). Esc closes an open panel, or turns Pin mode off.
- **Point pin.** Click anywhere. The pin attaches to the element you clicked, or its closest parent, that has a `data-node-id`. With no such element, it is a freeform pin.
- **Area pin.** Select text. Claude gets the exact text you selected.
- **Region pin.** Drag a rectangle, for example over part of an image.
- **Save or submit.** In the comment panel, Save pin keeps the pin as a draft (grey) without sending it. Submit to Claude sends it now (amber). When Claude answers, the pin turns green and the reply appears under your comment.
- **Submit all (N).** In the sidebar, this sends every saved draft at once. You can also send one saved pin from its own panel.
- **Follow-ups.** Click a pin to open its thread, then press Save reply or Submit reply.
- **Delete.** Use the × on a pin or on a comment. Deleting never notifies Claude.
- **Chat with Claude.** The panel at the bottom left. Your messages go to Claude without a pin. When Claude posts there, the panel opens and shows an unread count.
- **Download JSON.** In the sidebar. Saves every comment as `comments.json`.
- **Done / Shut down.** Stops the server and closes the channel, after you confirm.
- **Address.** Open the page at `http://localhost:<port>` or `http://127.0.0.1:<port>`. The server refuses requests that name any other host, refuses posts, deletes and WebSocket connections from other websites' pages, and accepts only JSON in a POST. So another site open in your browser cannot send comments to Claude, delete them, or stop the server.

## 5. What Claude receives

Each submitted pin arrives in the channel session as a `<channel source="<plugin-name>">` event. The comment text is the content. Every metadata value is a string:

| Field | Meaning |
|---|---|
| `chat_id` | `artifact` for pins, `chat` for chat messages |
| `comment_id`, `message_id` | the comment's id, which Claude passes to `mark_addressed` |
| `node_id`, `node_label` | the element the pin belongs to, or `freeform` |
| `ts` | when the comment was created |
| `comment_type` | `point`, `area` or `region` |
| `context_snippet` | the selected text (area pins) or nearby text (point pins) |
| `anchor_node_id` | the nearest element with a `data-node-id` |
| `pin_x`, `pin_y`, `page_width`, `page_height` | where on the page the pin was dropped |
| `region_box` | region pins only: `fx0,fy0,fx1,fy1`, as fractions of the anchor element's box |
| `parent_id` | present when the comment is a follow-up in a thread |

A chat message carries `chat_id="chat"`, `message_id`, `role` and `ts`, and no `node_id`.

The server's instructions tell Claude to make requested changes with `update_node`, then reply with `mark_addressed` in three sentences or fewer, and to answer chat messages with `post_message`.

## 6. Stop

Any of these stops the server and frees the port:

- the Done / Shut down button on the page
- ending the Claude Code session, or Ctrl-C in its terminal
- `bash <plugin-folder>/stop.sh`, which stops the process recorded in `.runtime.json`
- `bash <plugin-folder>/stop.sh --port <port>`, for a process stuck on the port with no `.runtime.json`

## 7. Customize

- **Your data.** `data.json` can be any JSON object. The starter shape is `{ "title": "...", "source": "...", "nodes": [ { "id": "...", "label": "...", "body": "..." } ] }`. The page shows `source` under the title.
- **Drawing.** Edit `renderArtifactInner(DATA)` in `index.html`. Give every element you want to comment on `data-node-id="<id>"`, where `<id>` matches an object's `id` in `data.json`. That is what lets `update_node` patch it. `references/building-the-viz.md` lists libraries by kind of artifact and has three worked examples.
- **Claude's instructions.** In `server.ts`, replace the `<<CUSTOMISE: ...>>` line inside `instructions` with what the data means and how replies should read.
- **More tools.** Add an entry to the `ListToolsRequestSchema` handler and a case to the `CallToolRequestSchema` switch in `server.ts`. Restart the MCP server (`/mcp`, then reconnect) after editing `server.ts`.
- **Your own requests.** Every request passes `refuseForeign()` in `server.ts` first, including any route you add. If you add a `fetch` call to `index.html`, send POST bodies as JSON with the header `content-type: application/json`, even an empty `"{}"`. Otherwise the server answers 415. A request from another origin or under another host name gets 403.
- **Port.** The port is written into `server.ts` and `start.sh` when the plugin is scaffolded. `server.ts` also reads it from the environment variable `<PLUGIN_NAME_UPPER>_PORT`, for example `ISSUE_BOARD_PORT`.

## 8. Build one by hand, without the skill

1. Make a plugin folder and copy the templates into it:

   | Template | Destination |
   |---|---|
   | `assets/plugin.json.template` | `.claude-plugin/plugin.json` |
   | `assets/mcp.json.template` | `.mcp.json` |
   | `assets/hooks.json.template` | `hooks.json` |
   | `assets/package.json.template` | `package.json` |
   | `assets/server.ts.template` | `server.ts` |
   | `assets/index.html.template` | `index.html` |
   | `assets/data.json.template` | `data.json` |
   | `assets/comments.json.template` | `comments.json` |
   | `assets/chat.json.template` | `chat.json` |
   | `assets/start.sh.template` | `start.sh` |
   | `assets/stop.sh.template` | `stop.sh` |

2. Replace the placeholders. Replace `__PLUGIN_NAME_UPPER__` before `__PLUGIN_NAME__`, because the second is part of the first.

   | Placeholder | Example | Notes |
   |---|---|---|
   | `__PLUGIN_NAME_UPPER__` | `ISSUE_BOARD` | Capital letters and underscores only. It becomes part of a variable name in `server.ts`, and a hyphen there makes the server crash on start. |
   | `__PLUGIN_NAME__` | `issue-board` | Kebab-case. Used as the MCP server name and the channel source. |
   | `__PORT__` | `5300` | Any free local port. |
   | `__TITLE__` | `Issue board` | Page title. |
   | `__DESCRIPTION__` | `Open issues I can comment on` | Plugin description. |

   From inside the plugin folder:

   ```bash
   for f in .claude-plugin/plugin.json .mcp.json package.json server.ts index.html start.sh stop.sh; do
     perl -pi -e 's/__PLUGIN_NAME_UPPER__/ISSUE_BOARD/g; s/__PLUGIN_NAME__/issue-board/g; s/__PORT__/5300/g; s/__TITLE__/Issue board/g; s/__DESCRIPTION__/Open issues I can comment on/g' "$f"
   done
   ```

3. Install the dependencies and make the scripts executable:

   ```bash
   bun install
   chmod +x start.sh stop.sh
   ```

4. Register the server in your project's root `.mcp.json`, using the absolute path to the plugin folder. If you skip this, `start.sh` writes the file at the git root for you.

   ```json
   {
     "mcpServers": {
       "issue-board": {
         "command": "bun",
         "args": ["run", "--cwd", "/absolute/path/to/issue-board", "--silent", "start"]
       }
     }
   }
   ```

5. Put your data in `data.json`, edit `renderArtifactInner()`, then launch as in section 3.

## 9. Run the tests

```bash
cd ~/.claude/skills/channel-artifact-skill
bun test ./test/lifecycle.test.ts
```

There are 29 tests. They copy the templates into a temp folder, run `bun install` there, and start real servers on port 5197. They check startup and every shutdown path, port cleanup, two sessions sharing one plugin, the chat panel, drafts, and how pins are stored. Seven of them check the request guard: posts, deletes, `/shutdown` and WebSocket connections from another origin are refused, a non-JSON POST is refused, a foreign host is refused, and the page's own same-origin requests still work. They need `lsof`.

## 10. When something breaks

`references/troubleshooting.md` covers launch failures, pins that never reach Claude, stuck ports, requests refused with 403 or 415, rendering problems and two sessions sharing one plugin. The most common silent failure is a non-string value in the channel metadata, which closes the MCP connection without an error. The template already converts every value to a string.
