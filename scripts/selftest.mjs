/**
 * Pure-logic self-test for xk-thought. Runs with plain Node (type stripping).
 *
 *   node scripts/selftest.mjs
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xk-thought-"));
process.env.PI_CODING_AGENT_DIR = tmp;

const yaml = await import("../extensions/thought-chain/lib/yaml.ts");
const frontmatter = await import("../extensions/thought-chain/lib/frontmatter.ts");
const glob = await import("../extensions/thought-chain/lib/glob.ts");
const cfgMod = await import("../extensions/thought-chain/config.ts");
const registry = await import("../extensions/thought-chain/registry.ts");
const state = await import("../extensions/thought-chain/state.ts");
const router = await import("../extensions/thought-chain/router.ts");
const runtime = await import("../extensions/thought-chain/runtime.ts");

let passed = 0;
let failed = 0;

function test(name, fn) {
	try {
		const result = fn();
		if (result && typeof result.then === "function") {
			return result.then(
				() => {
					passed++;
					console.log(`  ok   ${name}`);
				},
				(err) => {
					failed++;
					console.log(`  FAIL ${name}\n       ${err.message}`);
				},
			);
		}
		passed++;
		console.log(`  ok   ${name}`);
	} catch (err) {
		failed++;
		console.log(`  FAIL ${name}\n       ${err.message}`);
	}
}

console.log("xk-thought self-test\n");

await test("yaml subset parses nested maps and list of maps", () => {
	const parsed = yaml.parseYamlSubset(`
name: debug
when:
  keywords: [a, b]
  always: true
permissions:
  write: false
  budget: { maxTokens: 1000 }
phases:
  - id: one
    prompt: "first"
    exit: done
  - id: two
    tools: { add: [edit] }
`);
	assert.equal(parsed.name, "debug");
	assert.deepEqual(parsed.when.keywords, ["a", "b"]);
	assert.equal(parsed.when.always, true);
	assert.equal(parsed.permissions.write, false);
	assert.deepEqual(parsed.permissions.budget, { maxTokens: 1000 });
	assert.equal(parsed.phases.length, 2);
	assert.equal(parsed.phases[0].exit, "done");
	assert.deepEqual(parsed.phases[1].tools, { add: ["edit"] });
});

await test("frontmatter splits data and body", () => {
	const { data, body } = frontmatter.parseFrontmatter(`---\nname: x\n---\n# Body\ntext`);
	assert.equal(data.name, "x");
	assert.ok(body.startsWith("# Body"));
});

await test("globMatch handles ** and *", () => {
	assert.equal(glob.globMatch("**/*.log", "a/b/x.log"), true);
	assert.equal(glob.globMatch("**/*.log", "x.log"), true);
	assert.equal(glob.globMatch("src/**/*.ts", "src/a.ts"), true);
	assert.equal(glob.globMatch("src/**/*.ts", "src/a/b.ts"), true);
	assert.equal(glob.globMatch("src/**/*.ts", "lib/a.ts"), false);
	assert.equal(glob.globMatch("*.ts", "a/b.ts"), false);
});

await test("extractPaths finds @refs, slashy paths and filenames", () => {
	const found = glob.extractPaths("@src/a.ts 看看 src/b/c.py 和 x.log 以及 https://example.com/a.ts");
	assert.ok(found.includes("src/a.ts"));
	assert.ok(found.includes("src/b/c.py"));
	assert.ok(found.includes("x.log"));
	assert.ok(!found.some((p) => p.includes("example.com")));
});

await test("builtin chains load with permissions/phases/handoff", () => {
	const result = registry.loadChains(process.cwd());
	for (const name of ["react", "plan-execute", "debug", "research", "review"]) {
		assert.ok(result.chains.has(name), `missing ${name}`);
	}
	const debug = registry.resolveChain("debug", result.chains);
	assert.deepEqual(debug.phases.map((p) => p.id), ["reproduce", "locate", "fix", "verify"]);
	assert.equal(debug.permissions.write, true);
	assert.equal(debug.permissions.approval, "on-write");
	assert.equal(debug.handoff[0].chain, "review");
	assert.ok(debug.when.keywords.includes("bug"));
	const review = registry.resolveChain("review", result.chains);
	assert.deepEqual(review.tools.base, ["read", "grep", "find", "ls"]);
	assert.equal(review.permissions.write, false);
});

await test("legacy aliases normalize with warnings", () => {
	const { chain, warnings } = registry.normalizeChain(
		{
			name: "legacy",
			triggers: { keywords: ["x"] },
			tools: { extra: ["grep"], exclude: ["write"] },
			next: ["review"],
			autonomy: { unattended: true },
			output: { validate: true },
		},
		"body",
		"legacy.md",
		"legacy",
	);
	assert.deepEqual(chain.when.keywords, ["x"]);
	assert.deepEqual(chain.tools.add, ["grep"]);
	assert.deepEqual(chain.tools.remove, ["write"]);
	assert.deepEqual(chain.handoff, [{ chain: "review" }]);
	assert.equal(chain.permissions.unattended, true);
	assert.ok(warnings.some((w) => w.includes("triggers")));
	assert.ok(warnings.some((w) => w.includes("validate")));
});

await test("extends merges permissions/tools/handoff deterministically", () => {
	const dir = path.join(tmp, "chains");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "strict-review.md"),
		`---\nname: strict-review\nextends: [review]\nthinking: high\npermissions:\n  unattended: false\nhandoff:\n  - chain: writing\n    inputs: { report: review-report }\n---\nEXTRA\n`,
	);
	const result = registry.loadChains(process.cwd());
	const merged = registry.resolveChain("strict-review", result.chains);
	assert.equal(merged.thinking, "high");
	assert.equal(merged.permissions.write, false, "inherited from review");
	assert.equal(merged.permissions.unattended, false, "overridden by child");
	assert.deepEqual(merged.tools.base, ["read", "grep", "find", "ls"]);
	assert.ok(merged.handoff.some((h) => h.chain === "writing" && h.inputs.report === "review-report"));
	assert.ok(merged.body.includes("EXTRA") && merged.body.includes("代码审查者"));
});

await test("phase machine advances/gotos/clamps", () => {
	const chain = { name: "p", version: 1, description: "", body: "", sourcePath: "p", phases: [{ id: "a", prompt: "" }, { id: "b", prompt: "" }] };
	let s = state.initialState();
	assert.equal(state.phaseOf(chain, s).id, "a");
	s = state.advancePhase(chain, s);
	assert.equal(state.phaseOf(chain, s).id, "b");
	assert.equal(state.isLastPhase(chain, s), true);
	s = state.advancePhase(chain, s);
	assert.equal(s.phase, 1, "clamps at last phase");
	assert.equal(state.gotoPhase(chain, s, "a").phase, 0);
	assert.equal(state.gotoPhase(chain, s, "nope"), undefined);
});

await test("router matches keywords, globs, ambiguity and threshold", () => {
	const mk = (name, when) => ({ name, version: 1, description: "", body: "", sourcePath: name, when });
	const chains = [
		mk("debug", { keywords: ["报错", "崩溃"], fileGlobs: ["**/*.log"] }),
		mk("research", { keywords: ["调研"] }),
		mk("review", { keywords: ["审查"] }),
	];
	assert.equal(router.route("这里报错了", [], chains, 0.6).chain.name, "debug");
	assert.equal(router.route("看看文件", ["a/b/x.log"], chains, 0.6).chain.name, "debug");
	assert.equal(router.route("帮我调研一下", [], chains, 0.6).chain.name, "research");
	assert.equal(router.route("无关内容", [], chains, 0.6).chain, undefined);
	// ambiguous: both match with equal hits
	const tied = [mk("a", { keywords: ["x"] }), mk("b", { keywords: ["x"] })];
	assert.equal(router.route("x", [], tied, 0.6).reason, "ambiguous");
});

await test("selectDefault: config.default wins over always", () => {
	const mk = (name, always) => ({ name, version: 1, description: "", body: "", sourcePath: name, when: { always } });
	const cfg = cfgMod.defaultConfig();
	assert.equal(router.selectDefault({ ...cfg, default: "react" }, [mk("react", false), mk("repo", true)]).chain.name, "react");
	assert.equal(router.selectDefault({ ...cfg, default: null }, [mk("repo", true)]).chain.name, "repo");
	assert.equal(router.selectDefault({ ...cfg, default: null }, [mk("a", true), mk("b", true)]).reason, "always");
	assert.equal(router.selectDefault({ ...cfg, default: "missing" }, [mk("a", true)]).reason, "missing");
});

await test("computeTools: phase re-add, permission removal, core tool kept", () => {
	const chain = {
		name: "debug",
		version: 1,
		description: "",
		body: "",
		sourcePath: "debug",
		tools: { remove: ["edit", "write"] },
		permissions: { network: false, shell: false },
		phases: [
			{ id: "reproduce", prompt: "" },
			{ id: "fix", prompt: "", tools: { add: ["edit", "write"] } },
		],
	};
	const snapshot = ["read", "bash", "edit", "write", "grep", "web_search"];
	const atReproduce = runtime.computeTools(snapshot, chain, chain.phases[0]);
	assert.ok(!atReproduce.includes("edit") && !atReproduce.includes("write"), "removed at reproduce");
	assert.ok(!atReproduce.includes("bash"), "shell removed by permission");
	assert.ok(!atReproduce.includes("web_search"), "network removed by permission");
	assert.ok(atReproduce.includes("chain"), "core tool kept");
	const atFix = runtime.computeTools(snapshot, chain, chain.phases[1]);
	assert.ok(atFix.includes("edit") && atFix.includes("write"), "phase re-adds write tools");
});

await test("buildPrompt includes phase, denial and handoff suggestion", () => {
	const chain = {
		name: "debug",
		version: 1,
		description: "",
		body: "BODY",
		sourcePath: "debug",
		phases: [{ id: "a", prompt: "PHASE_A", exit: "E" }, { id: "last", prompt: "PHASE_LAST" }],
		permissions: { sideEffects: false },
		handoff: [{ chain: "review" }],
		output: { template: "bug-report" },
	};
	const s = { ...state.initialState(), chain: "debug", phase: 1 };
	const prompt = runtime.buildPrompt(chain, s);
	assert.ok(prompt.includes("思维链：debug") && prompt.includes("BODY"));
	assert.ok(prompt.includes("PHASE_LAST"));
	assert.ok(prompt.includes("不得产生外部副作用"));
	assert.ok(prompt.includes("建议交接：review"));
	assert.ok(prompt.includes("bug-report"));
});

await test("config: project override and env kill switch", () => {
	const cfg = cfgMod.loadConfig(process.cwd(), true);
	assert.equal(cfg.routing.auto, false);
	process.env.PI_THOUGHT_CHAIN = "0";
	const disabled = cfgMod.loadConfig(process.cwd(), true);
	assert.equal(disabled.enabled, false);
	delete process.env.PI_THOUGHT_CHAIN;
	cfgMod.invalidateConfigCache();
});

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
