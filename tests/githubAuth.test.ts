import { afterEach, describe, expect, it, mock } from "bun:test"
import { generateKeyPairSync, verify } from "node:crypto"
import { getGitHubHeaders } from "../src/utils/githubAuth.js"

const savedEnv = {
	GITHUB_APP_ID: process.env.GITHUB_APP_ID,
	GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,
	GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY
}
const originalFetch = globalThis.fetch
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })

afterEach(() => {
	globalThis.fetch = originalFetch
	for (const [name, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[name]
		else process.env[name] = value
	}
})

describe("GitHub App authentication", () => {
	for (const type of ["pkcs1", "pkcs8"] as const) {
		it(`signs a valid installation JWT with a ${type} PEM key`, async () => {
			process.env.GITHUB_APP_ID = "12345"
			process.env.GITHUB_APP_INSTALLATION_ID = "67890"
			process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type, format: "pem" }).toString()
			const exchange = mock(async (input: string | URL | Request, init?: RequestInit) => {
				expect(input).toBe("https://api.github.com/app/installations/67890/access_tokens")
				expect(init?.method).toBe("POST")
				const authorization = new Headers(init?.headers).get("Authorization")!
				const [header, payload, signature] = authorization.slice("Bearer ".length).split(".")
				expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" })
				const claims = JSON.parse(Buffer.from(payload, "base64url").toString())
				expect(claims.iss).toBe("12345")
				expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
				expect(claims.exp - claims.iat).toBe(600)
				expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true)
				return Response.json({ token: "synthetic-installation-token", expires_at: new Date(0).toISOString() })
			})
			globalThis.fetch = exchange as typeof fetch

			const headers = await getGitHubHeaders()
			expect(headers.Authorization).toBe("Bearer synthetic-installation-token")
			expect(exchange).toHaveBeenCalledTimes(1)
		})
	}
})
