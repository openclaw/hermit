import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as githubAuth from "../src/utils/githubAuth.js"
import {
	fetchGitHubSummaryData,
	isGitHubRepoName,
	isTrustedGitHubRepo
} from "../src/utils/githubSummary.js"

const issueJson = {
	html_url: "https://github.com/openclaw/openclaw/issues/1",
	number: 1,
	title: "Example",
	state: "open",
	labels: []
}

const captureFetch = () => {
	const calls: Array<{ url: string; authorization?: string }> = []
	const previousFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers)
		calls.push({
			url: String(input),
			authorization: headers.get("Authorization") ?? undefined
		})
		return new Response(JSON.stringify(issueJson), {
			status: 200,
			headers: { "Content-Type": "application/json" }
		})
	}) as typeof fetch
	return {
		calls,
		restore: () => {
			globalThis.fetch = previousFetch
		}
	}
}

afterEach(() => {
	delete process.env.OPENAI_API_KEY
	delete process.env.GITHUB_APP_ID
	delete process.env.GITHUB_APP_INSTALLATION_ID
	delete process.env.GITHUB_APP_PRIVATE_KEY
})

describe("isGitHubRepoName", () => {
	it("accepts GitHub owner and repo characters", () => {
		expect(isGitHubRepoName("openclaw")).toBe(true)
		expect(isGitHubRepoName("openclaw.ai")).toBe(true)
		expect(isGitHubRepoName("my_repo-1")).toBe(true)
	})

	it("rejects path and encoding bypasses", () => {
		const rejected = [
			"",
			".",
			"..",
			"foo/bar",
			"foo\\bar",
			"foo/../users",
			"%2e%2e",
			"%2f",
			"foo%2fbar",
			"foo?x=1",
			"foo#frag",
			"foo@evil",
			"https:",
			"foo bar",
			"foo\nbar",
			"foo\rbar",
			"foo\tbar",
			"foo/..",
			"..%2fusers",
			"／slash",
			"foo\0bar"
		]
		for (const value of rejected) {
			expect(isGitHubRepoName(value)).toBe(false)
		}
	})
})

describe("isTrustedGitHubRepo", () => {
	it("trusts only the default installation repo", () => {
		expect(isTrustedGitHubRepo("openclaw", "openclaw")).toBe(true)
		expect(isTrustedGitHubRepo("OpenClaw", "OpenClaw")).toBe(true)
		expect(isTrustedGitHubRepo("openclaw", "hermit")).toBe(false)
		expect(isTrustedGitHubRepo("octocat", "hello-world")).toBe(false)
		expect(isTrustedGitHubRepo("openclaw/../x", "openclaw")).toBe(false)
	})
})

describe("fetchGitHubSummaryData", () => {
	it("does not call GitHub when owner or repo can change the API path", async () => {
		const { calls, restore } = captureFetch()
		try {
			expect(await fetchGitHubSummaryData("foo/../users", "me", 1)).toBeNull()
			expect(await fetchGitHubSummaryData("openclaw", "openclaw/../hermit", 1)).toBeNull()
			expect(await fetchGitHubSummaryData(".", "openclaw", 1)).toBeNull()
			expect(await fetchGitHubSummaryData("openclaw", "..", 1)).toBeNull()
			expect(calls).toEqual([])
		} finally {
			restore()
		}
	})

	it("uses the App token only for openclaw/openclaw", async () => {
		const tokenSpy = spyOn(githubAuth, "getGitHubAppToken").mockResolvedValue(
			"installation-token"
		)
		const { calls, restore } = captureFetch()
		try {
			const publicData = await fetchGitHubSummaryData("octocat", "hello-world", 1)
			const trustedData = await fetchGitHubSummaryData("OpenClaw", "openclaw", 42)
			expect(publicData?.repoName).toBe("octocat/hello-world")
			expect(trustedData?.number).toBe(1)
			expect(tokenSpy).toHaveBeenCalledTimes(1)
			expect(calls).toEqual([
				{
					url: "https://api.github.com/repos/octocat/hello-world/issues/1",
					authorization: undefined
				},
				{
					url: "https://api.github.com/repos/OpenClaw/openclaw/issues/42",
					authorization: "Bearer installation-token"
				}
			])
		} finally {
			restore()
			tokenSpy.mockRestore()
		}
	})
})
