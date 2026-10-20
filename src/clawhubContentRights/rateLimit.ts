export type ContentRightsRateLimiter = Pick<RateLimit, "limit">

export const contentRightsRateLimitKey = (request: Request) =>
	`clawhub-content-rights:${request.headers.get("cf-connecting-ip")?.trim() || "unknown"}`

/**
 * Applies the per-IP submission limit. A missing binding (local dev, tests)
 * allows the request; a limiter error also allows it so an outage in the
 * limiter does not take the intake form down.
 */
export const isContentRightsSubmissionAllowed = async (
	request: Request,
	limiter: ContentRightsRateLimiter | null | undefined
) => {
	if (!limiter) {
		return true
	}
	try {
		const { success } = await limiter.limit({ key: contentRightsRateLimitKey(request) })
		return success
	} catch (error) {
		console.error("ClawHub content rights rate limiter failed; allowing request", error)
		return true
	}
}
