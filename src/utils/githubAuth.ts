import { Buffer } from "node:buffer"
import { sign } from "node:crypto"

type GitHubToken = {
	token: string
	expiresAt: number
}

let cachedToken: GitHubToken | null = null

const createGitHubJwt = (appId: string, privateKey: string) => {
	const now = Math.floor(Date.now() / 1000)
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
	const payload = Buffer.from(JSON.stringify({
		iat: now - 60,
		exp: now + 9 * 60,
		iss: appId
	})).toString("base64url")
	const signingInput = `${header}.${payload}`
	const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey)
	return `${signingInput}.${signature.toString("base64url")}`
}

export const getGitHubAppToken = async () => {
	if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
		return cachedToken.token
	}

	const appId = process.env.GITHUB_APP_ID
	const installationId = process.env.GITHUB_APP_INSTALLATION_ID
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
	if (!appId || !installationId || !privateKey) {
		return null
	}

	const jwt = createGitHubJwt(appId, privateKey)
	const response = await fetch(
		`https://api.github.com/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${jwt}`,
				"User-Agent": "hermit",
				"X-GitHub-Api-Version": "2022-11-28"
			}
		}
	)

	if (!response.ok) {
		return null
	}

	const data = await response.json() as { token?: string; expires_at?: string }
	if (!data.token) {
		return null
	}

	cachedToken = {
		token: data.token,
		expiresAt: data.expires_at ? Date.parse(data.expires_at) : Date.now() + 50 * 60_000
	}
	return cachedToken.token
}

export const getGitHubHeaders = async () => {
	const token = await getGitHubAppToken().catch(() => null)
	return {
		Accept: "application/vnd.github+json",
		"User-Agent": "hermit",
		"X-GitHub-Api-Version": "2022-11-28",
		...(token ? { Authorization: `Bearer ${token}` } : {})
	}
}
