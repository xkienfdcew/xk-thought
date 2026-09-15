/** Runtime helpers: tool computation, permission enforcement, prompt assembly. Pure. */

import type { ChainDef, ChainPermissions, ChainState, PhaseDef } from "./types.ts";
import { isLastPhase, phaseOf } from "./state.ts";

/** Tools that must stay active so the model/user can always inspect or advance chains. */
export const CORE_TOOLS = ["chain"];
export const NETWORK_TOOLS = ["web_search", "web_fetch"];
export const WRITE_TOOLS = ["edit", "write"];
export const SHELL_TOOLS = ["bash", "powershell"];

/** Human-readable denials for the model prompt (only prohibitive declarations). */
export function permissionDenials(perms?: ChainPermissions): string[] {
	if (!perms) return [];
	const denials: string[] = [];
	if (perms.sideEffects === false) denials.push("不得产生外部副作用（推送/发信/发布/外部写）");
	if (perms.subagents === false) denials.push("不得派生子 agent");
	if (perms.unattended === false) denials.push("不得无人值守执行");
	if (perms.network === false) denials.push("不得访问网络");
	return denials;
}

function removeAll(set: Set<string>, names: string[]): void {
	for (const name of names) set.delete(name);
}

/**
 * Effective active tools for a chain + phase.
 * Order: base -> chain.add -> chain.remove -> phase.add -> phase.remove -> permission removals.
 * A phase can therefore re-add a tool the chain removed. CORE_TOOLS are always kept.
 */
export function computeTools(snapshot: string[], chain: ChainDef, phase: PhaseDef | undefined): string[] {
	const set = new Set(chain.tools?.base ?? snapshot);
	for (const t of chain.tools?.add ?? []) set.add(t);
	for (const t of chain.tools?.remove ?? []) set.delete(t);
	for (const t of phase?.tools?.add ?? []) set.add(t);
	for (const t of phase?.tools?.remove ?? []) set.delete(t);

	const perms = chain.permissions ?? {};
	if (perms.network === false) removeAll(set, NETWORK_TOOLS);
	if (perms.write === false) removeAll(set, WRITE_TOOLS);
	if (perms.shell === false) removeAll(set, SHELL_TOOLS);

	for (const t of CORE_TOOLS) set.add(t);
	return [...set];
}

export interface PromptOptions {
	suggestHandoff: boolean;
}

/** Build the per-turn system-prompt addition for the active chain. */
export function buildPrompt(chain: ChainDef, state: ChainState, opts: PromptOptions = { suggestHandoff: true }): string {
	const phase = phaseOf(chain, state);
	const parts: string[] = [`## 思维链：${chain.name}`, chain.body];
	if (phase) {
		parts.push(`## 当前阶段（${phase.id}）`, phase.prompt);
		if (phase.exit) parts.push(`阶段完成条件：${phase.exit}。满足后调用 chain（action=phase）推进。`);
	}
	if (chain.skills?.length) parts.push(`推荐技能：${chain.skills.map((s) => `/skill:${s}`).join(", ")}`);
	if (chain.output?.template) parts.push(`输出模板：${chain.output.template}（由输出模板插件校验）。`);
	if (chain.output?.hint) parts.push(`输出要求：${chain.output.hint}`);
	const denials = permissionDenials(chain.permissions);
	if (denials.length) parts.push(`权限约束：${denials.join("；")}。`);
	if (opts.suggestHandoff && isLastPhase(chain, state) && chain.handoff?.length) {
		parts.push(`完成后建议交接：${chain.handoff.map((h) => h.chain).join(", ")}（由用户或宿主插件决定是否执行）。`);
	}
	return parts.filter((p) => p && p.trim().length > 0).join("\n\n");
}

export function describeChain(chain: ChainDef): string {
	const lines = [`# ${chain.name} (v${chain.version})`, chain.description];
	if (chain.when) {
		const when: string[] = [];
		if (chain.when.always) when.push("always");
		if (chain.when.keywords?.length) when.push(`keywords=${chain.when.keywords.join("|")}`);
		if (chain.when.fileGlobs?.length) when.push(`fileGlobs=${chain.when.fileGlobs.join("|")}`);
		if (when.length) lines.push(`when: ${when.join(", ")}`);
	}
	if (chain.thinking) lines.push(`thinking: ${chain.thinking}`);
	if (chain.skills?.length) lines.push(`skills: ${chain.skills.join(", ")}`);
	if (chain.tools) {
		lines.push(
			`tools: base=${chain.tools.base?.join(",") ?? "-"} add=${chain.tools.add?.join(",") ?? "-"} remove=${chain.tools.remove?.join(",") ?? "-"}`,
		);
	}
	if (chain.permissions) lines.push(`permissions: ${JSON.stringify(chain.permissions)}`);
	if (chain.output) lines.push(`output: ${JSON.stringify(chain.output)}`);
	if (chain.phases?.length) lines.push(`phases: ${chain.phases.map((p) => p.id).join(" -> ")}`);
	if (chain.handoff?.length) {
		lines.push(`handoff: ${chain.handoff.map((h) => (h.inputs ? `${h.chain}(${Object.keys(h.inputs).join(",")})` : h.chain)).join(", ")}`);
	}
	lines.push(chain.body);
	return lines.filter(Boolean).join("\n");
}
