import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as githubAuth from "../src/utils/githubAuth.js"
import { fetchGitHubSummaryData } from "../src/utils/githubSummary.js"

const originalFetch = globalThis.fetch
let headersSpy: ReturnType<typeof spyOn>
let calls: Array<{ url: string; authorization: string | null }>

beforeEach(() => {
	calls = []
	headersSpy = spyOn(githubAuth, "getGitHubHeaders").mockResolvedValue({ Authorization: "Bearer synthetic-token" })
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") })
		return Response.json({ html_url: "https://github.com/example/repo/issues/1", number: 1, title: "Example", state: "open", labels: [] })
	}) as typeof fetch
})

afterEach(() => {
	globalThis.fetch = originalFetch
	headersSpy.mockRestore()
})

describe("GitHub summary request boundary", () => {
	for (const value of ["", ".", "..", "foo/bar", "foo\\bar", "foo/../users", "%2e%2e", "%2f", "foo%2fbar", "foo?x=1", "foo#frag", "foo@evil", "https:", "foo bar", "foo\nbar", "foo\rbar", "foo\tbar", "foo/..", "..%2fusers", "／slash", "foo\0bar"]) {
		it(`rejects unsafe owner or repository ${JSON.stringify(value)} before authentication or network I/O`, async () => {
			expect(await fetchGitHubSummaryData(value, "repo", 1)).toBeNull()
			expect(await fetchGitHubSummaryData("owner", value, 1)).toBeNull()
			expect(calls).toEqual([])
			expect(headersSpy).not.toHaveBeenCalled()
		})
	}

	it("preserves configured installation authentication for all valid repository names", async () => {
		for (const [owner, repo] of [["OpenClaw", "openclaw"], ["openclaw", "hermit"], ["example-org", ".github"], ["octocat", "my_repo-1.2"]]) {
			expect((await fetchGitHubSummaryData(owner, repo, 1))?.repoName).toBe(`${owner}/${repo}`)
			expect(calls.at(-1)).toEqual({ url: `https://api.github.com/repos/${owner}/${repo}/issues/1`, authorization: "Bearer synthetic-token" })
		}
		expect(headersSpy).toHaveBeenCalledTimes(4)
	})

	it("keeps public summaries available without an installation token", async () => {
		headersSpy.mockResolvedValue({ Accept: "application/vnd.github+json" })
		expect(await fetchGitHubSummaryData("octocat", "hello-world", 1)).not.toBeNull()
		expect(calls[0]?.authorization).toBeNull()
	})
})
