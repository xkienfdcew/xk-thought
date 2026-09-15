/**
 * pi-thought-chain — switchable reasoning protocols for pi.
 *
 * Standalone plugin: it imports nothing from the task or output-template
 * plugins. Cross-plugin integration happens through `pi.events` and the
 * `thought-chain/state` session entry.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChainDef, ChainState } from "./types.ts";
import { invalidateConfigCache, loadConfig } from "./config.ts";
import { loadChains, resolveAll } from "./registry.ts";
import { advancePhase, gotoPhase, initialState, isLastPhase, phaseOf, phaseProgress } from "./state.ts";
import { route, selectDefault } from "./router.ts";
import { buildPrompt, computeTools, describeChain } from "./runtime.ts";
import { EVENTS } from "./events.ts";
import { registerChainTool } from "./tools.ts";
import { registerChainCommands, type CommandRuntime } from "./commands.ts";

const STATE_ENTRY = "thought-chain/state";
const TOUCHED_LIMIT = 64;
const READ_WRITE_TOOLS = new Set(["read", "edit", "write"]);

export default function thoughtChainExtension(pi: ExtensionAPI): void {
	let chains = new Map<string, ChainDef>();
	let chainState: ChainState = initialState();
	let sessionCtx: ExtensionContext | undefined;
	let toolsSnapshot: string[] | undefined;
	let touchedFiles: string[] = [];
	let completedEmitted = false;

	function getConfig() {
		return loadConfig(process.cwd());
	}

	function activeChain(): ChainDef | undefined {
		return chainState.chain ? chains.get(chainState.chain) : undefined;
	}

	function currentPhase() {
		return phaseOf(activeChain(), chainState);
	}

	function warn(message: string): void {
		if (message) console.warn(`[thought-chain] ${message}`);
	}

	function stateRecord(chain: ChainDef | undefined): ChainState {
		return {
			chain: chain?.name,
			phase: chain ? chainState.phase : 0,
			phaseId: chain ? phaseOf(chain, chainState)?.id : undefined,
			output: chain?.output,
			permissions: chain?.permissions,
			since: chainState.since,
			updatedAt: new Date().toISOString(),
		};
	}

	function updateStatus(): void {
		if (!sessionCtx?.hasUI) return;
		const chain = activeChain();
		if (!chain) {
			sessionCtx.ui.setStatus("thought-chain", undefined);
			return;
		}
		const progress = phaseProgress(chain, chainState);
		sessionCtx.ui.setStatus("thought-chain", `chain:${chain.name}${progress ? ` ${progress.index + 1}/${progress.total}` : ""}`);
	}

	function applyChain(chain: ChainDef): void {
		if (chain.thinking) pi.setThinkingLevel(chain.thinking);
		if (!toolsSnapshot) toolsSnapshot = pi.getActiveTools();
		pi.setActiveTools(computeTools(toolsSnapshot, chain, currentPhase()));
	}

	function restoreTools(): void {
		if (getConfig().tools.isolate && toolsSnapshot) pi.setActiveTools(toolsSnapshot);
		toolsSnapshot = undefined;
	}

	function activate(name: string, reason: string): { ok: boolean; message: string } {
		const chain = chains.get(name);
		if (!chain) return { ok: false, message: `Chain not found: ${name}` };
		chainState = {
			chain: name,
			phase: 0,
			phaseId: chain.phases?.[0]?.id,
			since: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		completedEmitted = false;
		applyChain(chain);
		pi.appendEntry(STATE_ENTRY, stateRecord(chain));
		pi.events.emit(EVENTS.activated, { name, phase: 0, output: chain.output, permissions: chain.permissions, reason });
		updateStatus();
		const first = chain.phases?.[0];
		return { ok: true, message: `Activated "${name}"${first ? ` (phase 1/${chain.phases?.length}: ${first.id})` : ""}.` };
	}

	function deactivate(): { ok: boolean; message: string } {
		const was = activeChain();
		restoreTools();
		chainState = initialState();
		completedEmitted = false;
		pi.appendEntry(STATE_ENTRY, stateRecord(undefined));
		pi.events.emit(EVENTS.deactivated, {});
		updateStatus();
		return { ok: true, message: was ? `Deactivated "${was.name}".` : "No active chain." };
	}

	function advance(): { ok: boolean; message: string } {
		const chain = activeChain();
		if (!chain) return { ok: false, message: "No active chain." };
		const phase = phaseOf(chain, chainState);
		if (!phase || isLastPhase(chain, chainState)) {
			if (!completedEmitted) {
				completedEmitted = true;
				pi.events.emit(EVENTS.completed, { name: chain.name, handoff: chain.handoff ?? [] });
			}
			return { ok: false, message: `Already at the last phase (${phase?.id ?? "-"}); handoff suggestion emitted.` };
		}
		if (getConfig().phases.enforceExit && !phase.exit) {
			return { ok: false, message: `Phase "${phase.id}" declares no exit condition; refusing to advance (enforceExit=true).` };
		}
		const from = chainState.phase;
		chainState = advancePhase(chain, chainState);
		applyChain(chain);
		pi.appendEntry(STATE_ENTRY, stateRecord(chain));
		pi.events.emit(EVENTS.phase, { name: chain.name, from, to: chainState.phase, phaseId: chainState.phaseId });
		updateStatus();
		return { ok: true, message: `Advanced to phase ${chainState.phaseId ?? chainState.phase + 1}.` };
	}

	function goTo(target: string): { ok: boolean; message: string } {
		const chain = activeChain();
		if (!chain) return { ok: false, message: "No active chain." };
		const nextState = gotoPhase(chain, chainState, /^\d+$/.test(target) ? Number(target) : target);
		if (!nextState) return { ok: false, message: `Unknown phase: ${target}` };
		const from = chainState.phase;
		chainState = nextState;
		completedEmitted = false;
		applyChain(chain);
		pi.appendEntry(STATE_ENTRY, stateRecord(chain));
		pi.events.emit(EVENTS.phase, { name: chain.name, from, to: chainState.phase, phaseId: chainState.phaseId });
		updateStatus();
		return { ok: true, message: `Now at phase ${chainState.phaseId ?? chainState.phase + 1}.` };
	}

	function resetPhase(): { ok: boolean; message: string } {
		const chain = activeChain();
		if (!chain) return { ok: false, message: "No active chain." };
		chainState = {
			...chainState,
			phase: 0,
			phaseId: chain.phases?.[0]?.id,
			since: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		completedEmitted = false;
		applyChain(chain);
		pi.appendEntry(STATE_ENTRY, stateRecord(chain));
		pi.events.emit(EVENTS.phase, { name: chain.name, from: -1, to: 0, phaseId: chainState.phaseId });
		updateStatus();
		return { ok: true, message: `Reset to phase ${chainState.phaseId ?? 1}.` };
	}

	function reload(): { ok: boolean; message: string } {
		invalidateConfigCache();
		const cfg = getConfig();
		const result = loadChains(process.cwd(), cfg.dirs);
		chains = resolveAll(result.chains);
		for (const w of result.warnings) warn(w);
		pi.events.emit(EVENTS.loaded, { count: chains.size, warnings: result.warnings });
		const chain = activeChain();
		if (chain) applyChain(chain);
		else updateStatus();
		return { ok: true, message: `Reloaded ${chains.size} chain(s)${result.warnings.length ? `, ${result.warnings.length} warning(s)` : ""}.` };
	}

	function restoreState(ctx: ExtensionContext): ChainState | undefined {
		let last: ChainState | undefined;
		for (const raw of ctx.sessionManager.getEntries()) {
			const entry = raw as { type?: string; customType?: string; data?: unknown };
			if (entry.type === "custom" && entry.customType === STATE_ENTRY && entry.data) last = entry.data as ChainState;
		}
		return last;
	}

	const runtime: CommandRuntime = {
		list: () => [...chains.values()].sort((a, b) => a.name.localeCompare(b.name)),
		active: () => {
			const chain = activeChain();
			return chain ? { chain, phase: chainState.phase } : undefined;
		},
		resolve: (name) => chains.get(name),
		use: (name) => activate(name, "tool"),
		off: () => deactivate(),
		advance: () => advance(),
		goto: (target) => goTo(target),
		reset: () => resetPhase(),
		reload: () => reload(),
		describe: (name) => {
			const chain = chains.get(name);
			return chain ? describeChain(chain) : `Chain not found: ${name}`;
		},
	};

	registerChainTool(pi, runtime);
	registerChainCommands(pi, runtime);

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
		touchedFiles = [];
		completedEmitted = false;
		const cfg = getConfig();
		if (!cfg.enabled) {
			chains = new Map();
			chainState = initialState();
			updateStatus();
			return;
		}
		const result = loadChains(process.cwd(), cfg.dirs);
		chains = resolveAll(result.chains);
		for (const w of result.warnings) warn(w);
		pi.events.emit(EVENTS.loaded, { count: chains.size, warnings: result.warnings });

		chainState = restoreState(ctx) ?? initialState();
		if (chainState.chain && !chains.has(chainState.chain)) {
			warn(`restored chain "${chainState.chain}" no longer exists`);
			chainState = initialState();
		}
		const restored = activeChain();
		if (restored) {
			applyChain(restored);
		} else {
			const picked = selectDefault(cfg, [...chains.values()]);
			if (picked.chain) activate(picked.chain.name, picked.reason);
			else if (picked.reason === "missing") warn(picked.detail ?? "");
		}
		updateStatus();
	});

	pi.on("tool_call", async (event) => {
		if (!READ_WRITE_TOOLS.has(event.toolName)) return;
		const p = (event.input as { path?: unknown } | undefined)?.path;
		if (typeof p === "string" && p.length > 0) {
			touchedFiles = [p, ...touchedFiles.filter((x) => x !== p)].slice(0, TOUCHED_LIMIT);
		}
	});

	pi.on("input", async (event) => {
		const cfg = getConfig();
		if (!cfg.enabled || !cfg.routing.auto) return { action: "continue" as const };
		if (chainState.chain) return { action: "continue" as const };
		if (event.source === "extension") return { action: "continue" as const };
		if (event.text.startsWith("/")) return { action: "continue" as const };
		const res = route(event.text, touchedFiles, [...chains.values()], cfg.routing.threshold);
		if (res.chain) activate(res.chain.name, "rule");
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event) => {
		const cfg = getConfig();
		if (!cfg.enabled) return;
		const chain = activeChain();
		if (!chain) return;
		const block = buildPrompt(chain, chainState, { suggestHandoff: cfg.handoff.suggest });
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});

	pi.on("session_shutdown", async () => {
		restoreTools();
		chainState = initialState();
		chains = new Map();
		touchedFiles = [];
		completedEmitted = false;
		sessionCtx = undefined;
	});
}
