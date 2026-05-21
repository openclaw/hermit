type GitHubToken = {
	token: string
	expiresAt: number
}

let cachedToken: GitHubToken | null = null

const base64UrlEncode = (value: string | ArrayBuffer) => {
	const bytes = typeof value === "string"
		? new TextEncoder().encode(value)
		: new Uint8Array(value)
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

const parsePrivateKey = (pem: string) => {
	const base64 = pem
		.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, "")
		.replace(/-----END (?:RSA )?PRIVATE KEY-----/, "")
		.replace(/\s+/g, "")
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}
	return bytes.buffer
}

const createGitHubJwt = async (appId: string, privateKey: string) => {
	const now = Math.floor(Date.now() / 1000)
	const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
	const payload = base64UrlEncode(JSON.stringify({
		iat: now - 60,
		exp: now + 9 * 60,
		iss: appId
	}))
	const signingInput = `${header}.${payload}`
	const key = await crypto.subtle.importKey(
		"pkcs8",
		parsePrivateKey(privateKey),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"]
	)
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(signingInput)
	)
	return `${signingInput}.${base64UrlEncode(signature)}`
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

	const jwt = await createGitHubJwt(appId, privateKey)
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
