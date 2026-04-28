type HermitEnv = Env

let currentEnv: HermitEnv | null = null

export const setRuntimeEnv = (env: HermitEnv) => {
	currentEnv = env
}

export const hydrateRuntimeEnv = (env: HermitEnv) => {
	setRuntimeEnv(env)

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

export const getRuntimeEnv = () => {
	if (!currentEnv) {
		throw new Error("Cloudflare env not initialized for this request")
	}

	return currentEnv
}

export type { HermitEnv }
