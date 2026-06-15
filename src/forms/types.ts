export type FormField =
	| {
		id: string
		label: string
		type: "text" | "textarea"
		required: boolean
		placeholder?: string
	}
	| {
		id: string
		label: string
		type: "select"
		required: boolean
		options: string[]
		placeholder?: string
	}
	| {
		id: string
		label: string
		type: "checkbox"
		required: boolean
		value?: string
	}
	| {
		id: string
		label: string
		type: "file"
		required: boolean
		accept?: string
		multiple?: boolean
	}
	| {
		id: string
		label: string
		type: "autofill"
		contextKey: string
		placeholder?: string
	}

export type FormAuthProvider = "discord" | "github" | "reddit"

export type FormTarget = "authUser" | "authUsername" | string

export type ModerationAction = "banned" | "muted" | "moderated"

export type FormConfig = {
	id: string
	title: string
	description: string
	auth: FormAuthProvider | FormAuthProvider[] | null
	requiredAction?: Exclude<ModerationAction, "moderated">
	reviewChannelId: string
	reviewRoleId: string | null
	successMessage: string
	fields: FormField[]
	actions: { accept: FormAction[]; deny: FormAction[] }
}

export type FormAction =
	| { type: "discord.addRole"; guildId: string; roleId: string; target: FormTarget }
	| { type: "discord.removeRole"; guildId: string; roleId: string; target: FormTarget }
	| { type: "discord.ban"; guildId: string; target: FormTarget; reason?: string }
	| { type: "discord.unban"; guildId: string; target: FormTarget; reason?: string }
	| { type: "discord.timeout"; guildId: string; target: FormTarget; seconds: number; reason?: string }
	| { type: "discord.removeTimeout"; guildId: string; target: FormTarget; reason?: string }
	| { type: "discord.resolveAppeal"; guildId: string; target: FormTarget; reason?: string }
	| { type: "github.blockOrgUser"; org: string; target: FormTarget }
	| { type: "github.unblockOrgUser"; org: string; target: FormTarget }
	| { type: "clawhub.unbanUser"; target: FormTarget; reason?: string }
	| { type: "reddit.unbanSubredditUser"; subreddit: string; target: FormTarget; reason?: string }
