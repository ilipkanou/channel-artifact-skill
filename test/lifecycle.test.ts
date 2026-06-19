/**
 * Lifecycle / teardown tests for the tool-channel-artifact templates.
 *
 * Scaffolds a temp instance from assets/*.template, then drives the REAL
 * lifecycle by spawning `bun server.ts` with a piped stdin (exactly how Claude
 * Code runs the MCP server) and closing that pipe to simulate session end.
 * A FIFO does NOT reproduce pipe-close EOF in Bun — use Bun.spawn.
 *
 * Run: bun test test/lifecycle.test.ts   (from the skill dir)
 */
import { test, expect, beforeAll, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SKILL_DIR = join(import.meta.dir, "..");
const ASSETS = join(SKILL_DIR, "assets");
const PLUGIN = "channeltest";
const UPPER = "CHANNELTEST";
const PORT = 5197;

let DIR = "";

function sub(s: string): string {
  return s
    .replaceAll("__PLUGIN_NAME_UPPER__", UPPER) // must precede __PLUGIN_NAME__ (substring)
    .replaceAll("__PLUGIN_NAME__", PLUGIN)
    .replaceAll("__PORT__", String(PORT))
    .replaceAll("__TITLE__", "Channel Test")
    .replaceAll("__DESCRIPTION__", "test artifact");
}

beforeAll(() => {
  // Clear any stray listener on the fixed test port so a leftover orphan can't
  // masquerade as our server (it would answer waitForUp but write no pidfile).
  const stray = Bun.spawnSync(["lsof", "-ti", `:${PORT}`]).stdout.toString().trim();
  if (stray) for (const p of stray.split("\n")) { try { process.kill(Number(p), 9); } catch {} }
  DIR = mkdtempSync(join(tmpdir(), "chtest-"));
  for (const f of ["server.ts", "index.html", "package.json", "stop.sh"]) {
    const src = join(ASSETS, `${f}.template`);
    if (!existsSync(src)) continue; // stop.sh.template may not exist yet (RED phase)
    writeFileSync(join(DIR, f), sub(readFileSync(src, "utf8")));
  }
  copyFileSync(join(ASSETS, "data.json.template"), join(DIR, "data.json"));
  copyFileSync(join(ASSETS, "comments.json.template"), join(DIR, "comments.json"));
  const r = Bun.spawnSync(["bun", "install", "--no-summary"], { cwd: DIR });
  if (!r.success) throw new Error("bun install failed: " + r.stderr.toString());
});

afterEach(async () => {
  const pids = lsofPort(PORT);
  if (pids) for (const p of pids.split("\n")) { try { process.kill(Number(p), 9); } catch {} }
  try { rmSync(join(DIR, ".runtime.json")); } catch {}
  await Bun.sleep(150);
});

function startServer() {
  return Bun.spawn(["bun", "server.ts"], { cwd: DIR, stdin: "pipe", stdout: "ignore", stderr: "pipe" });
}

async function waitForUp(port: number, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch {}
    await Bun.sleep(100);
  }
  return false;
}

function lsofPort(port: number): string {
  return Bun.spawnSync(["lsof", "-ti", `:${port}`]).stdout.toString().trim();
}
function portFree(port: number): boolean { return lsofPort(port) === ""; }

async function waitExited(proc: Bun.Subprocess, tries = 60): Promise<boolean> {
  const r = await Promise.race([proc.exited, Bun.sleep(tries * 100).then(() => "timeout")]);
  return r !== "timeout";
}

const RF = () => join(DIR, ".runtime.json");

test("C1: .runtime.json written on bind, removed on teardown", async () => {
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  expect(existsSync(RF())).toBe(true);
  const meta = JSON.parse(readFileSync(RF(), "utf8"));
  expect(meta.port).toBe(PORT);
  expect(meta.pid).toBe(proc.pid);
  proc.stdin.end();
  expect(await waitExited(proc, 40)).toBe(true);
  await Bun.sleep(150);
  expect(existsSync(RF())).toBe(false);
}, 30000);

test("AC2: closing stdin (session end) tears down + frees port", async () => {
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  proc.stdin.end(); // simulate Claude session end (pipe close)
  expect(await waitExited(proc, 40)).toBe(true);
  await Bun.sleep(150);
  expect(portFree(PORT)).toBe(true);
}, 30000);

test("AC3: SIGTERM tears down + frees port", async () => {
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  proc.kill("SIGTERM");
  expect(await waitExited(proc, 40)).toBe(true);
  await Bun.sleep(150);
  expect(portFree(PORT)).toBe(true);
}, 30000);

test("AC1: POST /shutdown tears down + frees port", async () => {
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  const res = await fetch(`http://127.0.0.1:${PORT}/shutdown`, { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ stopping: true });
  expect(await waitExited(proc, 40)).toBe(true);
  await Bun.sleep(150);
  expect(portFree(PORT)).toBe(true);
}, 30000);

test("AC6: stale .runtime.json (dead pid) reclaimed on start", async () => {
  writeFileSync(RF(), JSON.stringify({ pid: 999999, port: PORT, startedAt: "x" }));
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true); // binds despite stale pidfile
  const meta = JSON.parse(readFileSync(RF(), "utf8"));
  expect(meta.pid).toBe(proc.pid); // reclaimed: our pid replaced the dead one
  proc.stdin.end();
  await waitExited(proc, 40);
}, 30000);

test("AC5: second instance runs stdio-only; first survives + keeps the port", async () => {
  const first = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  const second = startServer();
  await Bun.sleep(900);
  expect(first.exitCode).toBeNull(); // first still running
  expect(lsofPort(PORT)).not.toBe(""); // port still held (by first)
  second.stdin.end(); // sibling session ends -> must NOT delete first's pidfile
  expect(await waitExited(second, 40)).toBe(true);
  const err = await new Response(second.stderr as ReadableStream).text();
  expect(err.toLowerCase()).toContain("stdio-only");
  expect(existsSync(RF())).toBe(true); // first's pidfile survived the sibling's teardown
  expect(first.exitCode).toBeNull();
  first.stdin.end();
  await waitExited(first, 40);
}, 30000);

test("AC4: stop.sh frees the port (valid pidfile, then --port orphan)", async () => {
  // (a) valid pidfile
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  const r1 = Bun.spawnSync(["bash", "stop.sh"], { cwd: DIR });
  expect(r1.success).toBe(true);
  await waitExited(proc, 40);
  await Bun.sleep(150);
  expect(portFree(PORT)).toBe(true);
  expect(existsSync(RF())).toBe(false);

  // (b) -9 orphan: process on the port, no pidfile, stop.sh --port
  const orphan = Bun.spawn(
    ["bun", "-e", `Bun.serve({port:${PORT},hostname:'127.0.0.1',fetch:()=>new Response('x')}); setInterval(()=>{},1e9)`],
    { cwd: DIR, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  await Bun.sleep(600);
  expect(lsofPort(PORT)).not.toBe("");
  const r2 = Bun.spawnSync(["bash", "stop.sh", "--port", String(PORT)], { cwd: DIR });
  expect(r2.success).toBe(true);
  await Bun.sleep(200);
  expect(portFree(PORT)).toBe(true);
  try { orphan.kill(9); } catch {}
}, 45000);

test("C4: artifact UI wires the Done button to /shutdown + server-stopping", () => {
  const html = readFileSync(join(DIR, "index.html"), "utf8");
  expect(html).toContain('id="shutdown-btn"');
  expect(html).toContain("/shutdown");
  expect(html).toContain("server-stopping");
  expect(html).toContain("showStoppedBanner");
});

test("CHAT-static: server exposes post_message + /chat + chat.json; UI wires the chat panel", () => {
  const server = readFileSync(join(DIR, "server.ts"), "utf8");
  expect(server).toContain("post_message");
  expect(server).toContain("/chat.json");
  expect(server).toContain("chat-updated");
  const html = readFileSync(join(DIR, "index.html"), "utf8");
  expect(html).toContain('id="chat-dock"');
  expect(html).toContain("/chat");
  expect(html).toContain("chat-updated");
  expect(html).toContain("loadChat");
});

test("CHAT-live: POST /chat persists a user message; GET /chat.json returns it (chat.json auto-created)", async () => {
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  const res = await fetch(`http://127.0.0.1:${PORT}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hello from the chat panel" }),
  });
  expect(res.status).toBe(200);
  const posted = await res.json();
  expect(posted.role).toBe("user");
  const chat = await (await fetch(`http://127.0.0.1:${PORT}/chat.json`)).json();
  expect(chat.messages.some((m) => m.text === "hello from the chat panel" && m.role === "user")).toBe(true);
  proc.stdin.end();
  await waitExited(proc, 40);
}, 30000);

test("PINS-static: server has /submit + saved status; UI wires save + submit-all", () => {
  const server = readFileSync(join(DIR, "server.ts"), "utf8");
  expect(server).toContain("/submit");
  expect(server).toContain('"saved"');
  const html = readFileSync(join(DIR, "index.html"), "utf8");
  expect(html).toContain('id="comment-save"');
  expect(html).toContain('id="submit-all"');
  expect(html).toContain("/submit");
});

test("PINS-live: a saved pin stays saved until POST /submit flips it to pending", async () => {
  const proc = startServer();
  expect(await waitForUp(PORT)).toBe(true);
  const created = await (await fetch(`http://127.0.0.1:${PORT}/comment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nodeId: "a", text: "draft pin", submit: false }),
  })).json();
  expect(created.status).toBe("saved");
  let comments = await (await fetch(`http://127.0.0.1:${PORT}/comments.json`)).json();
  expect(comments.comments.find((c) => c.id === created.id).status).toBe("saved");
  const submitted = await (await fetch(`http://127.0.0.1:${PORT}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })).json();
  expect(submitted.submitted).toContain(created.id);
  comments = await (await fetch(`http://127.0.0.1:${PORT}/comments.json`)).json();
  expect(comments.comments.find((c) => c.id === created.id).status).toBe("pending");
  proc.stdin.end();
  await waitExited(proc, 40);
}, 30000);
