/** Slash commands: /chain and /phase. */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ChainRuntime } from "./tools.ts";

export interface CommandRuntime extends ChainRuntime {
	reset(): { ok: boolean; message: string };
	reload(): { ok: boolean; message: string };
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.log(message);
}

export function registerChainCommands(pi: ExtensionAPI, runtime: CommandRuntime): void {
	pi.registerCommand("chain", {
		description: "Thought chains: /chain [list|use <name>|info <name>|off|reload]",
		getArgumentCompletions: (prefix) => {
			const names = runtime.list().map((c) => c.name);
			const suggestions = ["list", "use", "info", "off", "reload", ...names].filter((s) => s.startsWith(prefix));
			return suggestions.length ? suggestions.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const [sub, name] = args.trim().split(/\s+/);
			if (!sub || sub === "list") {
				const active = runtime.active();
				const lines = runtime
					.list()
					.map((c) => `${c.name === active?.chain.name ? "*" : " "} ${c.name}${c.description ? ` — ${c.description}` : ""}`);
				return notify(ctx, lines.length ? lines.join("\n") : "No chains found.");
			}
			if (sub === "use" && name) {
				const res = runtime.use(name, "command");
				return notify(ctx, res.message, res.ok ? "info" : "warning");
			}
			if (sub === "info" && name) {
				return notify(ctx, runtime.describe(name));
			}
			if (sub === "off") {
				const res = runtime.off();
				return notify(ctx, res.message, res.ok ? "info" : "warning");
			}
			if (sub === "reload") {
				const res = runtime.reload();
				return notify(ctx, res.message, res.ok ? "info" : "warning");
			}
			notify(ctx, "Usage: /chain [list|use <name>|info <name>|off|reload]", "warning");
		},
	});

	pi.registerCommand("phase", {
		description: "Thought-chain phases: /phase [next|goto <id>|reset]",
		handler: async (args, ctx) => {
			const [sub, target] = args.trim().split(/\s+/);
			if (!sub || sub === "next") {
				const res = runtime.advance();
				return notify(ctx, res.message, res.ok ? "info" : "warning");
			}
			if (sub === "goto" && target) {
				const res = runtime.goto(target);
				return notify(ctx, res.message, res.ok ? "info" : "warning");
			}
			if (sub === "reset") {
				const res = runtime.reset();
				return notify(ctx, res.message, res.ok ? "info" : "warning");
			}
			notify(ctx, "Usage: /phase [next|goto <id>|reset]", "warning");
		},
	});
}
