import { formConfigs as configuredFormConfigs } from "../../forms.config.js"
import type { FormAuthProvider, FormConfig } from "./types.js"

export const formConfigs = configuredFormConfigs

const discordConfigured = () => Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
const githubConfigured = () => Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET)
const redditConfigured = () => Boolean(process.env.REDDIT_OAUTH_CLIENT_ID && process.env.REDDIT_OAUTH_CLIENT_SECRET)
const clawHubConfigured = () => Boolean(process.env["CLAWHUB_BAN_APPEALS_TOKEN"])

export const isFormAuthProviderAvailable = (provider: FormAuthProvider) => {
	if (provider === "discord") return discordConfigured()
	if (provider === "github") return githubConfigured()
	if (provider === "reddit") return redditConfigured()
	return true
}

const isFormIntegrationAvailable = (form: FormConfig) => {
	if (form.id === "clawhub") return clawHubConfigured()
	return true
}

export const getFormAuthProviders = (form: FormConfig) => {
	const providers = form.auth === null ? [] : Array.isArray(form.auth) ? form.auth : [form.auth]
	return isFormIntegrationAvailable(form) ? providers.filter(isFormAuthProviderAvailable) : []
}

export const getAvailableFormConfigs = () =>
	formConfigs.filter((form) => form.auth === null || getFormAuthProviders(form).length > 0)

export const renderFormText = (text: string, values?: Record<string, string>) =>
	text
		.replaceAll("{ACTION}", values?.action || values?.ACTION || "moderated")
		.replaceAll("{UNACTION}", values?.unaction || values?.UNACTION || "reviewed")

export const getFormConfig = (id: string) =>
	getAvailableFormConfigs().find((form) => form.id === id) ?? null
