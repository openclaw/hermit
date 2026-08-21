type HermitEnv = Env

declare global {
	interface Env {
		CLAWHUB_CASE_FILES: R2Bucket
		ANSWER_OVERFLOW_API_KEY: string
		BASE_URL: string
		CLAWHUB_BAN_APPEALS_TOKEN: string
		CLAWHUB_HERMIT_TOKEN?: string
		CLAWHUB_SITE_URL?: string
		DEPLOY_SECRET: string
		DISCORD_BOT_TOKEN: string
		DISCORD_CLIENT_ID: string
		DISCORD_CLIENT_SECRET: string
		DISCORD_PUBLIC_KEY: string
		FORMS_BASE_URL: string
		FORWARDER_PUBLIC_KEY: string
		GITHUB_APP_ID: string
		GITHUB_APP_INSTALLATION_ID: string
		GITHUB_APP_PRIVATE_KEY: string
		GITHUB_APP_SLUG: string
		GITHUB_OAUTH_CLIENT_ID: string
		GITHUB_OAUTH_CLIENT_SECRET: string
		HELPER_THREAD_WELCOME_PARENT_ID: string
		HELPER_THREAD_WELCOME_TEMPLATE: string
		OPENAI_API_KEY: string
		RESEND_API_KEY: string
		THREAD_LENGTH_CHECK_INTERVAL_HOURS: string
		WORKER_EVENT_SECRET: string
		WORKER_EVENT_URL: string
	}
}

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
