// Full packaged Electron verification: real preload, daemon, storage, PTY and ACP.
// The provider is a deterministic fixture; no paid AI CLI or user project is used.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { _electron, expect } from "playwright/test";

const bundle = process.env.AO_GRID_APP_PATH;
if (!bundle?.endsWith("Agent Orchestrator Live Grid.app"))
	throw new Error("Provide AO_GRID_APP_PATH pointing to the separate Live Grid lab bundle.");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ao-grid-desktop-"));
console.log(`Isolated desktop profile: ${root}`);
const port = 32191;
const bin = path.join(root, "bin");
const repo = path.join(root, "project");
fs.mkdirSync(bin);
fs.mkdirSync(repo);
fs.mkdirSync(path.join(root, "evidence"));
const providerLog = path.join(root, "providers.jsonl");
fs.writeFileSync(providerLog, "");
const provider = path.resolve("e2e/support/live-grid-agent.cjs");
const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
const shim = path.join(bin, "opencode");
fs.writeFileSync(shim, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(provider)} "$@"\n`, { mode: 0o700 });
const shell = path.join(bin, "fixture-shell");
fs.writeFileSync(
	shell,
	'#!/bin/sh\nif [ "$1" = "-ilc" ]; then printf __AO_SHELL_ENV__; exec /usr/bin/env -0; fi\nexec /bin/sh "$@"\n',
	{ mode: 0o700 },
);
const env = {
	...process.env,
	PATH: `${bin}:${process.env.PATH}`,
	SHELL: shell,
	AO_LIVE_GRID_LAB_ROOT: root,
	AO_LIVE_GRID_LAB_PORT: String(port),
	AO_GRID_PROVIDER_LOG: providerLog,
	AO_KEEP_DAEMON: "0",
	OPENCODE_DATA_DIR: path.join(root, "opencode"),
	OPENCODE_CONFIG_CONTENT: "",
	AO_TELEMETRY_EVENTS: "off",
	AO_TELEMETRY_REMOTE: "off",
	AO_SENTRY_DSN: "",
};
const resolved = spawnSync(shell, ["-c", "command -v opencode"], { env, encoding: "utf8" });
assert.equal(
	resolved.stdout.trim().split("\n").at(-1),
	shim,
	"Login shell must select the fixture provider before any session is created",
);
await new Promise((resolve, reject) => {
	const server = net.createServer();
	server.once("error", reject);
	server.listen(port, "127.0.0.1", () => server.close(resolve));
});
const git = (...args) => {
	const result = spawnSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		env: {
			...env,
			GIT_AUTHOR_NAME: "Live Grid fixture",
			GIT_AUTHOR_EMAIL: "fixture@example.invalid",
			GIT_COMMITTER_NAME: "Live Grid fixture",
			GIT_COMMITTER_EMAIL: "fixture@example.invalid",
		},
	});
	assert.equal(result.status, 0, result.stderr);
};
git("init", "-b", "main");
fs.writeFileSync(path.join(repo, "README.md"), "# Isolated Live Grid fixture\n");
git("add", "README.md");
git("commit", "-m", "fixture");
git("remote", "add", "origin", repo);
git("fetch", "origin", "main");
git("remote", "set-head", "origin", "main");
const app = await _electron.launch({
	executablePath: path.join(bundle, "Contents/MacOS/agent-orchestrator"),
	args: [],
	env,
	timeout: 60_000,
});
const logs = [];
app.process().stdout?.on("data", (data) => logs.push(data.toString()));
app.process().stderr?.on("data", (data) => logs.push(data.toString()));
const sessions = [];
const errors = [];
const api = async (method, endpoint, body) => {
	const response = await fetch(`http://127.0.0.1:${port}/api/v1${endpoint}`, {
		method,
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const value = await response.json();
	if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(value)}`);
	return value;
};
const records = () =>
	fs
		.readFileSync(providerLog, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
const launches = () => records().filter((entry) => entry.event === "launch");
try {
	const page = await app.firstWindow();
	page.on("pageerror", (error) => errors.push(error.message));
	await expect
		.poll(
			async () => {
				try {
					return fs.existsSync(path.join(root, "running.json"))
						? ((await api("GET", "/projects")).projects ?? []).length
						: -1;
				} catch {
					return -1;
				}
			},
			{ timeout: 60_000 },
		)
		.toBe(0);
	assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), path.join(root, "electron"));
	await app.evaluate(({ BaseWindow }) => {
		const window = BaseWindow.getAllWindows()[0];
		window.setBounds({ ...window.getBounds(), width: 1500, height: 1000 });
	});
	const project = (await api("POST", "/projects", { path: repo })).project.id;
	const spawn = async (kind, mode, index) => {
		const value = await api("POST", "/sessions", {
			projectId: project,
			kind,
			mode,
			harness: "opencode",
			displayName: kind === "orchestrator" ? "Grid test orchestrator" : `Grid task ${index}`,
			prompt: `Isolated ${kind} ${index}`,
		});
		sessions.push(value.session.id);
		return value.session.id;
	};
	const orchestrator = await spawn("orchestrator", "chat", 0);
	await page.evaluate((id) => {
		window.location.hash = `/projects/${id}/grid`;
	}, project);
	const panels = page.getByTestId("grid-panel");
	for (const count of [1, 2, 4, 6, 9, 12]) {
		while (sessions.length < count) await spawn("worker", sessions.length < 3 ? "chat" : "tui", sessions.length);
		await expect(panels).toHaveCount(count, { timeout: 30_000 });
		await expect(panels.first()).toHaveAttribute("data-session-id", orchestrator);
		await expect.poll(() => launches().length, { timeout: 30_000 }).toBe(count);
		await page.screenshot({ path: path.join(root, "evidence", `desktop-${count}.png`) });
		console.log(`Verified ${count} existing sessions in packaged Electron`);
	}
	const baseline = launches();
	const worker = (id) => page.locator(`[data-testid="grid-panel"][data-session-id="${id}"]`);
	const chat = worker(sessions[1]);
	const draft = chat.getByRole("combobox", { name: "Message the agent" });
	await draft.fill("isolated-grid-chat-input");
	await draft.press("Enter");
	await expect(chat.getByRole("log", { name: "Conversation" })).toContainText("isolated-grid-chat-input", {
		timeout: 20_000,
	});
	const tui = worker(sessions[3]);
	await tui.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type("isolated-grid-tui-input");
	await expect
		.poll(
			() =>
				records()
					.filter((entry) => entry.event === "input" && entry.session === sessions[3])
					.map((entry) => entry.text)
					.join(""),
			{ timeout: 10_000 },
		)
		.toContain("isolated-grid-tui-input");
	await draft.fill("persistent grid draft");
	await chat.getByTestId("grid-panel-header").dblclick();
	await expect(tui).toBeHidden();
	await chat.getByRole("button", { name: "Restore grid" }).click();
	const separator = page.getByRole("separator", { name: "Resize columns" }).first();
	await separator.focus();
	await separator.press("Shift+ArrowRight");
	const width = (await panels.first().boundingBox()).width;
	await page.getByRole("button", { name: "Open Kanban", exact: true }).last().click();
	await expect(page.getByTestId("live-grid")).toHaveCount(0);
	await page.getByRole("button", { name: "Open Grid", exact: true }).last().click();
	await expect(panels).toHaveCount(12);
	await expect(draft).toHaveText("persistent grid draft");
	assert.ok(Math.abs((await panels.first().boundingBox()).width - width) < 2);
	assert.deepEqual(launches(), baseline, "Changing presentation must not launch provider processes");
	for (const entry of baseline) process.kill(entry.pid, 0);
	await api("POST", `/sessions/${sessions.at(-1)}/kill`, {});
	await expect(panels).toHaveCount(11, { timeout: 20_000 });
	await page.getByRole("checkbox", { name: "Show completed" }).check();
	await expect(panels).toHaveCount(12);
	await page.screenshot({ path: path.join(root, "evidence", "desktop-final.png") });
	const metrics = await app.evaluate(({ app }) =>
		app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu, memory })),
	);
	assert.deepEqual(errors, [], "Renderer errors");
	fs.writeFileSync(
		path.join(root, "verification.json"),
		JSON.stringify(
			{
				bundle,
				root,
				project,
				sessions,
				providerPids: baseline.map((entry) => entry.pid),
				metrics,
				errors,
				passed: true,
			},
			null,
			2,
		),
	);
	console.log(`PASS: native verification artifacts at ${root}`);
} finally {
	// Only this fixture's explicit IDs, through this isolated daemon.
	for (const id of sessions) {
		try {
			await api("POST", `/sessions/${id}/kill`, {});
		} catch {}
	}
	fs.writeFileSync(path.join(root, "electron.log"), logs.join(""));
	// AO's macOS Cmd+Q normally closes the window into its tray. End only this
	// launched test process after all fixture sessions have been terminated.
	await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
	await app.close().catch(() => {});
}
