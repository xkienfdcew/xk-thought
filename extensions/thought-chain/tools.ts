/** Model-facing `chain` tool: inspect / switch / advance the active thought chain. */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChainDef } from "./types.ts";

export interface ChainRuntime {
	list(): ChainDef[];
	active(): { chain: ChainDef; phase: number } | undefined;
	resolve(name: string): ChainDef | undefined;
	use(name: string, reason?: string): { ok: boolean; message: string };
	off(): { ok: boolean; message: string };
	advance(): { ok: boolean; message: string };
	goto(target: string): { ok: boolean; message: string };
	describe(name: string): string;
}

export function registerChainTool(pi: ExtensionAPI, runtime: ChainRuntime): void {
	pi.registerTool({
		name: "chain",
		label: "Thought Chain",
		description:
			"Inspect, switch, or advance the active thought chain (a reasoning protocol: prompt + skills + tools + thinking + phases).",
		promptSnippet: "Switch the active reasoning protocol (thought chain)",
		promptGuidelines: [
			"Use the chain tool when the task type clearly changes (debugging vs research vs long multi-step work); prefer it over ad-hoc prompt rewrites.",
			"When the current phase's exit condition is met, call chain with action=phase to advance.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("list"),
				Type.Literal("use"),
				Type.Literal("info"),
				Type.Literal("off"),
				Type.Literal("phase"),
			]),
			name: Type.Optional(Type.String({ description: "Chain name for use/info" })),
			phase: Type.Optional(Type.String({ description: 'Target phase id or index, or "next"' })),
			reason: Type.Optional(Type.String({ description: "Why the chain is being switched/advanced" })),
		}),
		async execute(_id, params) {
			const action = params.action;
			if (action === "list") {
				const active = runtime.active();
				const lines = runtime
					.list()
					.map((c) => `${c.name === active?.chain.name ? "*" : " "} ${c.name}${c.description ? ` — ${c.description}` : ""}`);
				return { content: [{ type: "text", text: lines.join("\n") || "No chains found." }], details: { chains: runtime.list().map((c) => c.name) } };
			}
			if (action === "info") {
				if (!params.name) return { content: [{ type: "text", text: "chain info requires name" }], isError: true };
				if (!runtime.resolve(params.name)) return { content: [{ type: "text", text: `Chain not found: ${params.name}` }], isError: true };
				return { content: [{ type: "text", text: runtime.describe(params.name) }] };
			}
			if (action === "use") {
				if (!params.name) return { content: [{ type: "text", text: "chain use requires name" }], isError: true };
				const res = runtime.use(params.name, params.reason);
				return { content: [{ type: "text", text: res.message }], isError: !res.ok };
			}
			if (action === "off") {
				const res = runtime.off();
				return { content: [{ type: "text", text: res.message }], isError: !res.ok };
			}
			const target = params.phase ?? "next";
			const res = target === "next" ? runtime.advance() : runtime.goto(target);
			return { content: [{ type: "text", text: res.message }], isError: !res.ok };
		},
	});
}
