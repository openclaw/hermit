import { CloudflareGatewayDurableObject } from "@buape/carbon/cloudflare-gateway"

const hydrateProcessEnv = (env: Env) => {
	if (typeof process === "undefined") {
		Reflect.set(globalThis, "process", { env })
		return
	}

	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") {
			process.env[key] = value
		}
	}
}

export { CloudflareGatewayDurableObject }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		hydrateProcessEnv(env)
		const app = await import("./index.js")
		return app.default.fetch(request, env, ctx)
	},
	async scheduled(
		controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext
	) {
		hydrateProcessEnv(env)
		const app = await import("./index.js")
		if (typeof app.default.scheduled === "function") {
			return app.default.scheduled(controller, env, ctx)
		}
	}
} satisfies ExportedHandler<Env>
