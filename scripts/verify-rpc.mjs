#!/usr/bin/env node
/**
 * Real-pi end-to-end verification for xk-thought (no model calls).
 *
 *   node scripts/verify-rpc.mjs
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const extPath = process.env.PI_THOUGHT_CHAIN_EXT
	? path.resolve(process.env.PI_THOUGHT_CHAIN_EXT)
	: path.join(repo, "extensions", "thought-chain", "index.ts");

function resolveCli() {
	if (process.env.PI_CLI && fs.existsSync(process.env.PI_CLI)) return process.env.PI_CLI;
	const candidates = [];
	if (process.env.APPDATA) {
		candidates.push(
			path.join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
		);
	}
	candidates.push(
		path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
	);
	return candidates.find((c) => fs.existsSync(c));
}

const cli = resolveCli();
if (!cli) {
	console.error("FAIL: cannot locate the pi CLI (set PI_CLI).");
	process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xk-thought-e2e-"));
const agentDir = path.join(tmp, "agent");
fs.mkdirSync(agentDir, { recursive: true });
const realAgent = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
for (const name of ["auth.json", "models-store.json", "settings.json"]) {
	const src = path.join(realAgent, name);
	if (fs.existsSync(src)) fs.copyFileSync(src, path.join(agentDir, name));
}
// Isolated config: no default chain, plus an `always` chain to exercise the fallback.
fs.mkdirSync(path.join(agentDir, "thought-chain"), { recursive: true });
fs.writeFileSync(
	path.join(agentDir, "thought-chain", "config.json"),
	JSON.stringify({ default: null, routing: { auto: false } }, null, 2),
);
fs.mkdirSync(path.join(agentDir, "chains"), { recursive: true });
fs.writeFileSync(
	path.join(agentDir, "chains", "always-test.md"),
	`---\nname: always-test\nwhen: { always: true }\n---\nAlways chain used by verification.\n`,
);

const env = {
	...process.env,
	PI_CODING_AGENT_DIR: agentDir,
	PI_OFFLINE: "1",
	PI_SKIP_VERSION_CHECK: "1",
	PI_TELEMETRY: "0",
	PI_THOUGHT_CHAIN_EXT: extPath,
};

const child = spawn(process.execPath, [cli, "--mode", "rpc", "-e", extPath], {
	env,
	cwd: repo,
	stdio: ["pipe", "pipe", "pipe"],
});

const responses = new Map();
const notifications = [];
const events = [];
let stderr = "";
let stdoutRaw = "";
let buffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	stdoutRaw += chunk;
	buffer += chunk;
	for (;;) {
		const idx = buffer.indexOf("\n");
		if (idx < 0) break;
		const line = buffer.slice(0, idx).replace(/\r$/, "");
		buffer = buffer.slice(idx + 1);
		if (!line.trim()) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			continue;
		}
		if (msg.type === "response" && msg.id) responses.set(msg.id, msg);
		else if (msg.type === "extension_ui_request") notifications.push(msg);
		else events.push(msg);
	}
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
	stderr += chunk;
});

const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);

function waitFor(predicate, timeoutMs, label) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const poll = () => {
			const value = predicate();
			if (value) return resolve(value);
			if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${label}`));
			setTimeout(poll, 60);
		};
		poll();
	});
}
const waitResponse = (id, timeoutMs = 15000) =>
	waitFor(() => responses.get(id), timeoutMs, `response ${id}`).then((r) => {
		if (!r.success) throw new Error(`response ${id} failed: ${JSON.stringify(r)}`);
		return r;
	});
const waitNotify = (matcher, timeoutMs = 15000) =>
	waitFor(() => notifications.find((n) => n.method === "notify" && matcher(String(n.message ?? ""))), timeoutMs, "notify").then((n) =>
		String(n.message),
	);

let passed = 0;
let failed = 0;
async function check(name, fn) {
	try {
		const detail = await fn();
		passed++;
		console.log(`  ok   ${name}${detail ? `  (${detail})` : ""}`);
	} catch (err) {
		failed++;
		console.log(`  FAIL ${name}\n       ${err.message}`);
	}
}

console.log(`xk-thought RPC verification\n  ext: ${extPath}\n`);

try {
	await waitFor(() => events.length > 0 || responses.size > 0 || notifications.length > 0, 20000, "pi startup").catch(() => {});
	send({ id: "c0", type: "get_commands" });

	await check("extension commands registered", async () => {
		const r = await waitResponse("c0");
		const names = (r.data?.commands ?? []).map((c) => c.name);
		for (const expected of ["chain", "phase"]) {
			if (!names.includes(expected)) throw new Error(`missing /${expected}`);
		}
		return "chain, phase";
	});

	await check("when.always chain is active at session start", async () => {
		send({ id: "c1", type: "prompt", message: "/chain list" });
		await waitResponse("c1");
		const message = await waitNotify((m) => m.includes("always-test"));
		if (!/\*\s*always-test/.test(message)) throw new Error(`always-test not marked active:\n${message}`);
		return "always-test";
	});

	await check("/chain use debug activates phases", async () => {
		send({ id: "c2", type: "prompt", message: "/chain use debug" });
		await waitResponse("c2");
		const message = await waitNotify((m) => m.includes('Activated "debug"'));
		if (!message.includes("reproduce")) throw new Error(message);
		return "reproduce";
	});

	await check("/chain info shows phases and permissions", async () => {
		send({ id: "c3", type: "prompt", message: "/chain info debug" });
		await waitResponse("c3");
		const message = await waitNotify((m) => m.includes("reproduce") && m.includes("locate"));
		if (!message.includes("permissions")) throw new Error("permissions missing");
		return "ok";
	});

	await check("/phase next advances", async () => {
		send({ id: "c4", type: "prompt", message: "/phase next" });
		await waitResponse("c4");
		await waitNotify((m) => m.includes("Advanced to phase locate"));
		return "locate";
	});

	await check("/phase goto jumps", async () => {
		send({ id: "c5", type: "prompt", message: "/phase goto verify" });
		await waitResponse("c5");
		await waitNotify((m) => m.includes("Now at phase verify"));
		return "verify";
	});

	await check("/phase reset returns to first phase", async () => {
		send({ id: "c6", type: "prompt", message: "/phase reset" });
		await waitResponse("c6");
		await waitNotify((m) => m.includes("Reset to phase reproduce"));
		return "reproduce";
	});

	await check("/chain off deactivates", async () => {
		send({ id: "c7", type: "prompt", message: "/chain off" });
		await waitResponse("c7");
		await waitNotify((m) => m.includes('Deactivated "debug"'));
		return "ok";
	});

	await check("/chain reload rescans files", async () => {
		send({ id: "c8", type: "prompt", message: "/chain reload" });
		await waitResponse("c8");
		await waitNotify((m) => /Reloaded \d+ chain/.test(m));
		return "ok";
	});

	await check("no extension_error events", async () => {
		const errors = events.filter((e) => e.type === "extension_error");
		if (errors.length > 0) throw new Error(JSON.stringify(errors.slice(0, 2)));
		return "clean";
	});
} catch (err) {
	failed++;
	console.log(`  FAIL harness\n       ${err.stack || err.message}`);
} finally {
	try {
		child.kill();
	} catch {
		// ignore
	}
}

if (failed > 0) {
	console.log("\n--- stderr (tail) ---");
	console.log(stderr.slice(-1500));
	console.log("\n--- stdout (tail) ---");
	console.log(stdoutRaw.slice(-1500));
}
console.log(`\n${passed} passed, ${failed} failed`);
console.log(`artifacts: ${agentDir}`);
process.exit(failed === 0 ? 0 : 1);
