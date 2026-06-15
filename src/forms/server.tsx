import type { Client } from "@buape/carbon"
import { buildFormReviewContainer } from "./reviewButtons.js"
import { formSettings } from "../../forms.config.js"
import { getAvailableFormConfigs, getFormAuthProviders, getFormConfig, renderFormText } from "./forms.js"
import type { FormAuthProvider, FormConfig } from "./types.js"
import {
	createFormSubmission,
	getFormSubmission,
	markFormSubmissionSent,
	parseSubmissionPayload,
	updateFormSubmissionPayload
} from "./submissions.js"
import { getRuntimeEnv } from "../runtime/env.js"
import { fetchFormContext } from "./context.js"
import { upsertRedditModerationContext } from "./redditContext.js"
import {
	createOAuthState,
	createSession,
	readSession,
	readSignedToken
} from "./auth.js"
import {
	AuthGateRoute,
	FormRoute,
	renderPage,
	renderReactRouter,
	renderResultPage
} from "./render.js"
import { storeEvidenceFile } from "../clawhubContentRights/intake.js"
import {
	appendContentRightsEvent,
	createContentRightsCase,
	recordContentRightsFile
} from "../clawhubContentRights/cases.js"
import {
	ContentRightsValidationError,
	intakeContentRightsCase
} from "../clawhubContentRights/workflow.js"
import { sendContentRightsReceipt } from "../clawhubContentRights/receipt.js"

const discordApiBase = "https://discord.com/api/v10"
const githubApiBase = "https://api.github.com"
const redditApiBase = "https://oauth.reddit.com"
const formHosts = new Set(["appeals.openclaw.ai", "forms.openclaw.ai"])
const localUsers: Record<FormAuthProvider, { id: string; username: string; provider: FormAuthProvider }> = {
	discord: { id: "679604208940351488", username: "peetiegonzalez", provider: "discord" },
	github: { id: "123456", username: "thewilloftheshadow", provider: "github" },
	reddit: { id: "t2_openclaw", username: "u/openclaw", provider: "reddit" }
}

const isFormsDev = () => process.env.FORMS_DEV === "1"
const isFormHost = (url: URL) => formHosts.has(url.hostname) || isFormsDev()

const devvitRedditContextPath = "/api/devvit/reddit/context"

const isFormsRequest = (request: Request) => {
	const url = new URL(request.url)
	if (url.pathname === devvitRedditContextPath) {
		return true
	}
	const formPath = getAvailableFormConfigs().some((form) =>
		url.pathname === `/${form.id}` ||
		url.pathname === `/${form.id}/submit`
	)
	return isFormHost(url) && (
		url.pathname === "/" ||
		url.pathname.startsWith("/oauth/") ||
		formPath
	)
}

const normalizeFormsRequest = (request: Request) => new Request(new URL(request.url), request)

const getRequestOrigin = (request: Request) => {
	const url = new URL(request.url)
	const host = request.headers.get("host")
	return host ? `${url.protocol}//${host}` : url.origin
}

const getCanonicalOrigin = () =>
	process.env.FORMS_BASE_URL?.replace(/\/$/, "") || "https://appeals.openclaw.ai"

const getOrigin = (request: Request) =>
	process.env.FORMS_BASE_URL?.replace(/\/$/, "") || getRequestOrigin(request)

const jsonHeaders = () => ({
	Authorization: `Bot ${getRuntimeEnv().DISCORD_BOT_TOKEN}`,
	"content-type": "application/json"
})

const discordDmInstallUrl = () => {
	const url = new URL(`${discordApiBase}/oauth2/authorize`)
	url.searchParams.set("client_id", getRuntimeEnv().DISCORD_CLIENT_ID)
	url.searchParams.set("integration_type", "1")
	url.searchParams.set("scope", "applications.commands")
	return url.toString()
}

const discordDmInstallAction = () => ({
	href: discordDmInstallUrl(),
	label: "Allow Hermit to send you messages",
	description: "Want a Discord DM when this submission is reviewed?"
})

const collectPayload = async (request: Request) => {
	const body = await request.formData()
	const payload: Record<string, string> = {}
	body.forEach((value, key) => {
		if (key !== "session") {
			payload[key] = String(value).trim()
		}
	})
	return { payload, session: String(body.get("session") ?? "") }
}

const actionLabel = (action: string) => {
	if (action === "banned") return "ban"
	if (action === "muted") return "mute"
	return "moderation action"
}

const eligibilityError = (form: FormConfig, values: Record<string, string>, username?: string) =>
	form.requiredAction && values.action !== form.requiredAction
		? `No active ${actionLabel(form.requiredAction)} found for ${username || "this account"}.`
		: null

const validatePayload = (form: FormConfig, payload: Record<string, string>, values: Record<string, string>, username?: string) => {
	const eligibility = eligibilityError(form, values, username)
	if (eligibility) {
		return eligibility
	}
	for (const field of form.fields) {
		if (field.type === "autofill") {
			continue
		}
		const value = payload[field.id] ?? ""
		if (field.required && !value) {
			return `${renderFormText(field.label, values)} is required.`
		}
	}
	return null
}

const contextUnavailableResponse = (form: FormConfig, error: unknown) => {
	console.error(`Failed to fetch ${form.id} form context`, error)
	return new Response(
		renderResultPage(
			form.title,
			"We couldn't verify your account's moderation status right now. Please try again later or contact staff.",
			false
		),
		{ status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
	)
}

const fetchFormContextValues = async (form: FormConfig, user: { id: string; username: string }) =>
	Object.fromEntries(
		Object.entries(await fetchFormContext(form, user)).map(([key, value]) => [key, String(value ?? "")])
	)

const threadNameFor = (form: FormConfig, submission: Awaited<ReturnType<typeof createFormSubmission>>) => {
	if (form.id === "clawhub-content-rights") {
		const payload = parseSubmissionPayload(submission)
		return `${payload.caseId || form.title} - ${payload.organization || payload.requesterName || "Unknown"}`.slice(0, 100)
	}
	const provider = submission.authProvider
		? `${submission.authProvider.charAt(0).toUpperCase()}${submission.authProvider.slice(1)}`
		: "Unknown"
	return `${form.title} - ${submission.applicantUsername ?? submission.applicantId ?? "Unknown"} (${provider})`.slice(0, 100)
}

const sendReview = async (
	client: Client,
	form: FormConfig,
	submission: Awaited<ReturnType<typeof createFormSubmission>>
) => {
	const channel = await client.fetchChannel(form.reviewChannelId)
	if (!channel || !("send" in channel)) {
		throw new Error(`Review channel ${form.reviewChannelId} is not sendable.`)
	}
	const message = await channel.send({
		components: [buildFormReviewContainer(form, submission)],
		allowedMentions: form.reviewRoleId ? { roles: [form.reviewRoleId], users: [] } : { parse: [] }
	})
	const threadResponse = await fetch(
		`${discordApiBase}/channels/${form.reviewChannelId}/messages/${message.id}/threads`,
		{
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				name: threadNameFor(form, submission),
				auto_archive_duration: 1440
			})
		}
	)
	const thread = threadResponse.ok ? await threadResponse.json() as { id: string } : null
	await markFormSubmissionSent(submission.id, {
		reviewMessageId: message.id,
		reviewThreadId: thread?.id ?? null
	})
}

const discordCallback = async (request: Request) => {
	const url = new URL(request.url)
	const state = await readSignedToken(url.searchParams.get("state"))
	if (!state || state.provider !== "discord" || typeof state.formId !== "string" || typeof state.origin !== "string") {
		return new Response(renderResultPage("Sign in failed", "Invalid or expired Discord sign-in.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const response = await fetch(`${discordApiBase}/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: getRuntimeEnv().DISCORD_CLIENT_ID,
			client_secret: getRuntimeEnv().DISCORD_CLIENT_SECRET,
			grant_type: "authorization_code",
			code: url.searchParams.get("code") ?? "",
			redirect_uri: `${state.origin}/oauth/discord/callback`
		})
	})
	const token = response.ok ? (await response.json() as { access_token?: string }).access_token : null
	const userResponse = token ? await fetch(`${discordApiBase}/users/@me`, { headers: { authorization: `Bearer ${token}` } }) : null
	const user = userResponse?.ok ? await userResponse.json() as { id: string; username: string } : null
	if (!user) {
		return new Response(renderResultPage("Sign in failed", "Discord did not return a user.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const session = await createSession({ formId: state.formId, provider: "discord", id: user.id, username: user.username })
	return Response.redirect(`${state.origin}/${state.formId}?session=${encodeURIComponent(session)}`, 302)
}

const githubCallback = async (request: Request) => {
	const url = new URL(request.url)
	const state = await readSignedToken(url.searchParams.get("state"))
	const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
	const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET
	if (!state || state.provider !== "github" || typeof state.formId !== "string" || typeof state.origin !== "string" || !clientId || !clientSecret) {
		return new Response(renderResultPage("Sign in failed", "GitHub OAuth is not configured or the sign-in expired.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: url.searchParams.get("code"), redirect_uri: `${state.origin}/oauth/github/callback` })
	})
	const token = response.ok ? (await response.json() as { access_token?: string }).access_token : null
	const userResponse = token ? await fetch(`${githubApiBase}/user`, { headers: { authorization: `Bearer ${token}`, "User-Agent": "hermit" } }) : null
	const user = userResponse?.ok ? await userResponse.json() as { id: number; login: string } : null
	if (!user) {
		return new Response(renderResultPage("Sign in failed", "GitHub did not return a user.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const session = await createSession({ formId: state.formId, provider: "github", id: String(user.id), username: user.login })
	return Response.redirect(`${state.origin}/${state.formId}?session=${encodeURIComponent(session)}`, 302)
}

const redditCallback = async (request: Request) => {
	const url = new URL(request.url)
	const state = await readSignedToken(url.searchParams.get("state"))
	const clientId = process.env.REDDIT_OAUTH_CLIENT_ID
	const clientSecret = process.env.REDDIT_OAUTH_CLIENT_SECRET
	if (!state || state.provider !== "reddit" || typeof state.formId !== "string" || typeof state.origin !== "string" || !clientId || !clientSecret) {
		return new Response(renderResultPage("Sign in failed", "Reddit OAuth is not configured or the sign-in expired.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const credentials = btoa(`${clientId}:${clientSecret}`)
	const response = await fetch("https://www.reddit.com/api/v1/access_token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${credentials}`,
			"User-Agent": "OpenClaw Hermit Forms",
			"content-type": "application/x-www-form-urlencoded"
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: url.searchParams.get("code") ?? "",
			redirect_uri: `${state.origin}/oauth/reddit/callback`
		})
	})
	const token = response.ok ? (await response.json() as { access_token?: string }).access_token : null
	const userResponse = token ? await fetch(`${redditApiBase}/api/v1/me`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "OpenClaw Hermit Forms" } }) : null
	const user = userResponse?.ok ? await userResponse.json() as { id: string; name: string } : null
	if (!user) {
		return new Response(renderResultPage("Sign in failed", "Reddit did not return a user.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const session = await createSession({ formId: state.formId, provider: "reddit", id: user.id, username: `u/${user.name}` })
	return Response.redirect(`${state.origin}/${state.formId}?session=${encodeURIComponent(session)}`, 302)
}

const formAllowsProvider = (form: FormConfig, provider: FormAuthProvider) =>
	getFormAuthProviders(form).includes(provider)

const readFormUser = async (request: Request, form: FormConfig) => {
	if (isFormsDev()) {
		return localUsers[getFormAuthProviders(form)[0] ?? "discord"]
	}
	const user = await readSession(new URL(request.url).searchParams.get("session"), form.id)
	return user && formAllowsProvider(form, user.provider as FormAuthProvider) ? user : null
}

const handleFormGet = async (request: Request, form: FormConfig) => {
	if (form.auth === null) {
		return new Response(renderPage(form.title, <FormRoute form={form} session={null} user={null} />), {
			headers: { "content-type": "text/html; charset=utf-8" }
		})
	}
	const session = new URL(request.url).searchParams.get("session")
	const user = await readFormUser(request, form)
	if (!user) {
		const providers = getFormAuthProviders(form)
		if (providers.length === 1) {
			return Response.redirect(`${getRequestOrigin(request)}/oauth/${providers[0]}/start?form=${encodeURIComponent(form.id)}`, 302)
		}
		return new Response(renderPage(form.title, <AuthGateRoute form={form} />), { headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const values = await fetchFormContextValues(form, user).catch((error) => contextUnavailableResponse(form, error))
	if (values instanceof Response) {
		return values
	}
	const error = eligibilityError(form, values, user.username)
	if (error) {
		return new Response(renderResultPage(form.title, error, false), { status: 403, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	return new Response(renderPage(form.title, <FormRoute form={form} session={session ?? "local"} user={user} values={values} />), { headers: { "content-type": "text/html; charset=utf-8" } })
}

const handleFormSubmit = async (request: Request, form: FormConfig, client: Client) => {
	if (form.id === "clawhub-content-rights" && form.auth === null) {
		try {
			const body = await request.formData()
			const result = await intakeContentRightsCase(body, {
				createSubmission: (payload) => createFormSubmission({
					formId: form.id,
					authProvider: null,
					applicantId: null,
					applicantUsername: null,
					payload,
					reviewChannelId: form.reviewChannelId
				}),
				updateSubmissionPayload: updateFormSubmissionPayload,
				createCase: createContentRightsCase,
				storeFile: (caseId, kind, file) =>
					storeEvidenceFile(getRuntimeEnv().CLAWHUB_CASE_FILES, caseId, kind, file),
				recordFile: recordContentRightsFile,
				appendEvent: appendContentRightsEvent,
				sendReceipt: sendContentRightsReceipt
			})
			const submission = await getFormSubmission(result.submission.id)
			if (!submission) {
				throw new Error(`Could not reload content rights submission ${result.submission.id}.`)
			}
			await sendReview(client, form, submission)
			await appendContentRightsEvent({
				caseId: result.caseId,
				eventType: "discord_review_posted",
				metadata: { reviewChannelId: form.reviewChannelId }
			})
			return new Response(
				renderResultPage(
					"Submitted",
					result.receiptSent
						? form.successMessage
						: "Submitted. We received your request, but could not send the email receipt.",
					true
				),
				{ headers: { "content-type": "text/html; charset=utf-8" } }
			)
		} catch (error) {
			if (error instanceof ContentRightsValidationError) {
				return new Response(
					renderPage(form.title, <FormRoute form={form} session={null} user={null} error={error.message} />),
					{ status: 400, headers: { "content-type": "text/html; charset=utf-8" } }
				)
			}
			console.error("Failed to submit ClawHub content rights request", error)
			return new Response(
				renderResultPage(
					form.title,
					"We could not submit this request right now. Please try again later.",
					false
				),
				{ status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
			)
		}
	}
	const collected = await collectPayload(request)
	const sessionUser = isFormsDev() ? localUsers[getFormAuthProviders(form)[0] ?? "discord"] : await readSession(collected.session, form.id)
	const user = sessionUser && formAllowsProvider(form, sessionUser.provider as FormAuthProvider) ? sessionUser : null
	if (!user) {
		return new Response(renderPage(form.title, <AuthGateRoute form={form} error="Sign in expired. Try again." />), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const context = await fetchFormContextValues(form, user).catch((error) => contextUnavailableResponse(form, error))
	if (context instanceof Response) {
		return context
	}
	const error = validatePayload(form, collected.payload, context, user.username)
	if (error) {
		return new Response(renderPage(form.title, <FormRoute form={form} session={collected.session} user={user} values={context} error={error} />), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const payload = {
		...context,
		...collected.payload
	}
	const submission = await createFormSubmission({
		formId: form.id,
		authProvider: user.provider,
		applicantId: user.id,
		applicantUsername: user.username,
		payload,
		reviewChannelId: form.reviewChannelId
	})
	await sendReview(client, form, submission)
	return new Response(
		renderResultPage(
			"Submitted",
			form.successMessage,
			true,
			user.provider === "discord" ? discordDmInstallAction() : undefined
		),
		{ headers: { "content-type": "text/html; charset=utf-8" } }
	)
}

const handleDevvitRedditContext = async (request: Request) => {
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 })
	}
	const secret = process.env.DEVVIT_REDDIT_BRIDGE_SECRET
	const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
	const headerSecret = request.headers.get("x-devvit-secret")
	if (!secret || (authorization !== secret && headerSecret !== secret)) {
		return new Response("Unauthorized", { status: 401 })
	}
	const body = await request.json().catch(() => null) as null | {
		subreddit?: unknown
		username?: unknown
		action?: unknown
		unaction?: unknown
		banReason?: unknown
		moderator?: unknown
		bannedAt?: unknown
		expiresAt?: unknown
	}
	if (!body || typeof body.username !== "string") {
		return new Response(JSON.stringify({ error: "username is required" }), {
			status: 400,
			headers: { "content-type": "application/json" }
		})
	}
	const action = body.action === "banned" || body.action === "muted" || body.action === "moderated"
		? body.action
		: "banned"
	const unaction = typeof body.unaction === "string"
		? body.unaction
		: action === "banned" ? "unbanned" : action === "muted" ? "unmuted" : "reviewed"
	const context = await upsertRedditModerationContext({
		subreddit: typeof body.subreddit === "string" ? body.subreddit : formSettings.redditSubreddit,
		username: body.username,
		action,
		unaction,
		banReason: typeof body.banReason === "string" ? body.banReason : null,
		moderator: typeof body.moderator === "string" ? body.moderator : null,
		bannedAt: typeof body.bannedAt === "string" ? body.bannedAt : null,
		expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
		rawPayload: JSON.stringify(body)
	})
	return new Response(JSON.stringify({ ok: true, id: context.id }), {
		headers: { "content-type": "application/json" }
	})
}

const startOAuth = async (request: Request, provider: FormAuthProvider) => {
	const url = new URL(request.url)
	const form = getFormConfig(url.searchParams.get("form") ?? "")
	if (!form) {
		return new Response(renderResultPage("Unknown form", "That form does not exist.", false), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	if (!formAllowsProvider(form, provider)) {
		return new Response(renderResultPage("Wrong sign-in method", "Use the sign-in method shown on the form.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	if (isFormsDev()) {
		const user = localUsers[provider]
		const session = await createSession({ formId: form.id, provider: user.provider, id: user.id, username: user.username })
		return Response.redirect(`${getRequestOrigin(request)}/${form.id}?session=${encodeURIComponent(session)}`, 302)
	}
	const origin = provider === "github" ? getCanonicalOrigin() : getOrigin(request)
	const state = await createOAuthState(form.id, origin, provider)
	if (provider === "discord") {
		const oauthUrl = new URL(`${discordApiBase}/oauth2/authorize`)
		oauthUrl.searchParams.set("client_id", getRuntimeEnv().DISCORD_CLIENT_ID)
		oauthUrl.searchParams.set("redirect_uri", `${origin}/oauth/discord/callback`)
		oauthUrl.searchParams.set("response_type", "code")
		oauthUrl.searchParams.set("scope", "identify")
		oauthUrl.searchParams.set("state", state)
		return Response.redirect(oauthUrl.toString(), 302)
	}
	if (provider === "github") {
		const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
		if (!clientId) {
			return new Response(renderResultPage("GitHub OAuth unavailable", "Configure GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET first.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
		}
		const oauthUrl = new URL("https://github.com/login/oauth/authorize")
		oauthUrl.searchParams.set("client_id", clientId)
		oauthUrl.searchParams.set("redirect_uri", `${origin}/oauth/github/callback`)
		oauthUrl.searchParams.set("scope", "read:user")
		oauthUrl.searchParams.set("state", state)
		return Response.redirect(oauthUrl.toString(), 302)
	}
	const clientId = process.env.REDDIT_OAUTH_CLIENT_ID
	if (!clientId) {
		return new Response(renderResultPage("Reddit OAuth unavailable", "Configure REDDIT_OAUTH_CLIENT_ID and REDDIT_OAUTH_CLIENT_SECRET first.", false), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
	}
	const oauthUrl = new URL("https://www.reddit.com/api/v1/authorize")
	oauthUrl.searchParams.set("client_id", clientId)
	oauthUrl.searchParams.set("redirect_uri", `${origin}/oauth/reddit/callback`)
	oauthUrl.searchParams.set("response_type", "code")
	oauthUrl.searchParams.set("duration", "temporary")
	oauthUrl.searchParams.set("scope", "identity read")
	oauthUrl.searchParams.set("state", state)
	return Response.redirect(oauthUrl.toString(), 302)
}

export const handleFormsRequest = async (request: Request, client: Client) => {
	if (!isFormsRequest(request)) {
		return null
	}
	const normalized = normalizeFormsRequest(request)
	const url = new URL(normalized.url)
	if (url.pathname === devvitRedditContextPath) return handleDevvitRedditContext(normalized)
	if (url.pathname === "/oauth/discord/callback") return discordCallback(normalized)
	if (url.pathname === "/oauth/github/callback") return githubCallback(normalized)
	if (url.pathname === "/oauth/reddit/callback") return redditCallback(normalized)
	if (url.pathname === "/oauth/discord/start") return startOAuth(normalized, "discord")
	if (url.pathname === "/oauth/github/start") return startOAuth(normalized, "github")
	if (url.pathname === "/oauth/reddit/start") return startOAuth(normalized, "reddit")
	const form = getAvailableFormConfigs().find((item) => url.pathname === `/${item.id}` || url.pathname === `/${item.id}/submit`)
	if (form && normalized.method === "GET") return handleFormGet(normalized, form)
	if (form && normalized.method === "POST") return handleFormSubmit(normalized, form, client)
	return renderReactRouter(normalized)
}
