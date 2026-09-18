import { createHmac } from "node:crypto"
import type { Artifact } from "./types.js"

// Content is transient. Fenced/inline code and Markdown quotations are not writing signals.
export function conversationalText(content: string): string {
	let fence: "`" | "~" | null = null
	let fenceLength = 0
	let multiQuote = false
	const lines: string[] = []

	for (const line of content.slice(0, 16000).split(/\r?\n/)) {
		const trimmed = line.trimStart()
		if (multiQuote) continue
		if (trimmed.startsWith(">>>")) {
			multiQuote = true
			continue
		}
		if (trimmed.startsWith(">")) {
			const isAiThoughtLine =
				/^>\s*(?:[🧠💭]|(?:\*\*)?(?:Thinking|Planning|Formulating|Reasoning|Refining|Analyzing|Drafting|Evaluating|Designing|Preparing|Establishing|Prioritizing|Assigning|Defining)\b)/iu.test(
					trimmed
				)
			if (!isAiThoughtLine) continue
		}
		const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1]
		if (marker) {
			const kind = marker[0] as "`" | "~"
			if (!fence) {
				fence = kind
				fenceLength = marker.length
			} else if (fence === kind && marker.length >= fenceLength) {
				fence = null
			}
			continue
		}
		if (!fence) lines.push(line.replace(/^>\s*/, ""))
	}
	return lines
		.join(" ")
		.replace(/(`+)[\s\S]*?\1/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

export interface ExtractedFeatures {
	contentLength: number
	lineCount: number
	fingerprint: string
	artifacts: Artifact[]
}

export function contentFeatures(
	content: string,
	key: string,
	guildId: string,
	authorId: string,
	options?: { untyped?: boolean; hasMedia?: boolean }
): ExtractedFeatures {
	const text = conversationalText(content).normalize("NFKC")
	const lineCount = content.split(/\r?\n/).length
	const artifacts: Artifact[] = []

	// Explicitly attributed logs/examples are excluded from content signals
	const attributed =
		/\b(?:pasted|example output|debug logs|(?:my|the) (?:agent|bot|model) (?:said|returned|printed|replied|output)|here is the output|(?:error|output|logs?) (?:I|we) (?:got|received)|stack trace)\b/i.test(
			text
		)
	const isBotCommand = /^[!$?%&/\\^~-][a-zA-Z]{2,20}(?:\s|$)/.test(text)
	if (attributed || isBotCommand) {
		return {
			contentLength: 0,
			lineCount,
			fingerprint: createHmac("sha256", key)
				.update(`${guildId}:${authorId}:empty`)
				.digest("hex"),
			artifacts: []
		}
	}

	if (
		/(?:<tool_call>[^]*<\/tool_call>|"tool_calls"\s*:\s*\[\s*\{|<function_calls>[^]*<\/function_calls>|<think>[\s\S]*?<\/think>)/i.test(
			text
		)
	) {
		artifacts.push("tool-envelope")
	}

	if (
		/(?:["']?tool_use_id["']?\s*[:=]\s*["']?[a-z0-9_-]+|assistant\s+to=(?:functions|tools)\.[a-z_]+|recipient_name\s*[=:]\s*["']?(?:functions|tools)\.[a-z_]+|[🧠💭]\s*(?:\*\*|__)?(?:[A-Za-z]+|\b)|(?:\*\*|\b)(?:Thinking Process|Planning detailed|Formulating assumption|Drafting multi-perspective|Planning benchmark|Planning autonomous|Planning hostile)\b)/iu.test(
			text
		)
	) {
		artifacts.push("execution-marker")
	}

	if (
		/\b(?:as an? (?:ai|assistant|language model)|i(?:\x27m| am) an? (?:ai|assistant|language model))\b/i.test(
			text
		) ||
		/(?:^|\b)(?:certainly!?|of course!?|sure thing!?|definitely!?|absolutely!?|glad to help!?|happy to assist!?|i(?:\x27d| would) be (?:happy|glad) to help|great question!?|here(?:\x27s| is) (?:a (?:quick )?(?:breakdown|summary|overview|step-by-step)|what you (?:can do|need to know)):)/i.test(
			text
		) ||
		/\b(?:it(?:\x27s| is) (?:important|crucial|worth|essential) (?:to note|noting|remembering|keeping in mind) that|keep in mind that|please note that|bear in mind that|in summary,|in conclusion,|here is a (?:quick )?breakdown:)\b/i.test(
			text
		) ||
		/\b(?:i hope this helps!?|hope this helps!?|hope that helps!?|let me know if (?:you (?:have any (?:further|other)? ?questions|need (?:further|more) (?:help|assistance|clarification))|that makes sense|you\x27d like me to|you need anything else)|feel free to (?:ask|reach out) if you need|don\x27t hesitate to (?:ask|reach out)|happy coding!?)\b/i.test(
			text
		) ||
		/\b(?:(?:to answer|regarding|in response to) your (?:question|inquiry|point)|you(?:\x27re| are) asking (?:about|how|whether)|as for your question|based on (?:the|your) (?:information|description|details|context) provided)\b/i.test(
			text
		) ||
		/\b(?:on (?:the )?one hand[\s\S]{5,80}on the other hand|while it(?:\x27s| is) true that[\s\S]{5,80}however)\b/i.test(
			text
		) ||
		/\b(?:additionally,\s+(?:you (?:can|may|might)|it(?:\x27s| is))|furthermore,\s+|moreover,\s+|consequently,\s+)\b/i.test(
			text
		) ||
		/\b(?:apologies for (?:the|any) confusion|thank you for (?:bringing this to|pointing this out)|i appreciate your patience|that\x27s an? (?:excellent|great) question)\b/i.test(
			text
		) ||
		/\b(?:(?:summary of (?:findings|results)|key findings|steps to reproduce|proof of concept|root cause analysis|impact analysis|remediation steps?|mitigation steps?|recommended actions?):)\b/i.test(
			text
		) ||
		/\b(?:execution (?:completed|finished|failed|started)|running (?:script|exploit|test|scan|checks?)|starting (?:enumeration|scan|analysis)|analyzing (?:results?|output|target)|completed in \d+(?:\.\d+)?\s*(?:s|ms|seconds?))\b/i.test(
			text
		) ||
		/\b(?:i have (?:executed|run|tested|analyzed|identified|scanned|verified)|based on the (?:analysis|scan results?|output)|according to the (?:output|logs?|results?))\b/i.test(
			text
		) ||
		/(?:^|\b)(?:preparing direct response|planning detailed|formulating assumption|defining retrieval|establishing defect|prioritizing (?:four|\d+)|refining (?:four|\d+)|assigning exact|defining hard-failure|defining unauthorized|planning benchmark|proposing contamination|designing bounded|summarizing autonomous|planning hostile|designing automated|planning separate acknowledgement)\b/i.test(
			text
		)
	) {
		artifacts.push("ai-discourse")
	}

	const structuredItems = (
		text.match(/(?:^|\s)(?:\d+\.|\*|-)\s+\*\*[^*]{2,30}\*\*[:\s]/g) || []
	).length
	const standardListItems = (
		text.match(/(?:^|\s)(?:\d+\.|\*|-)\s+[A-Za-z0-9]/g) || []
	).length
	const markdownHeaders = /(?:^|\s)#{1,4}\s+[A-Za-z0-9][^\n]{2,60}/.test(text)
	const emDashClause = structuredItems >= 1 && /(?:\s+—\s+|\w—\w)/.test(text)
	const boldHeaderLines = (text.match(/\*\*[A-Za-z0-9\s]{3,50}\*\*/g) || []).length
	if (
		structuredItems >= 2 ||
		standardListItems >= 3 ||
		markdownHeaders ||
		emDashClause ||
		boldHeaderLines >= 3
	) {
		artifacts.push("ai-formatting")
	}

	if (options?.untyped && text.length >= 200) {
		artifacts.push("untyped-long-message")
	}

	const humanSlang =
		/\b(?:idk|tbh|imo|imho|lmao|lol|haha|hahaha|nah|yep|yea|yeah|afaik|btw|ngl|fr|gg|brb|ty|thx|pls|smh|oof|rip|ikr|omg|bruh|dude|bro|sus|wip|prolly|tbf|fwiw|gonna|wanna|gotcha|lemme|kinda|sorta|dunno|sup|yo|aye|pog|poggers|based|cringe|cap|no cap|wth|omw|nvm|welp)\b/i
	const expressivePunct = /(?:\?{2,}|\!{2,}|\b[a-z]*([a-z])\1{2,}[a-z]*\b)/i
	const discordEmotes =
		/<a?:[a-zA-Z0-9_]{2,32}:\d{17,20}>|[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
	const discordMentions = /<@!?\d{17,20}>|<#\d{17,20}>|\|\|[^|]+\|\|/
	const isTechnicalOrCode =
		/(?:cve-\d{4}-\d+|python\d*|\.\w{2,4}\b|--\w+|[a-z0-9_]+=[a-z0-9_]+|https?:\/\/|[\/\\_])/i.test(
			text
		)
	const casualLowercase =
		/^[a-z]+(?:\s+[a-z]+){2,10}$/.test(text) ||
		(!isTechnicalOrCode &&
			/^[a-z][^.!?;\n]*\s+[^.!?;\n]*\s+[^.!?;\n]*[^.!?;\s]$/.test(text))

	const hasAiMarkers =
		artifacts.includes("ai-discourse") ||
		artifacts.includes("ai-formatting") ||
		artifacts.includes("tool-envelope") ||
		artifacts.includes("execution-marker")
	if (
		!hasAiMarkers &&
		(options?.hasMedia ||
			humanSlang.test(text) ||
			expressivePunct.test(text) ||
			discordEmotes.test(text) ||
			(!isTechnicalOrCode && (discordMentions.test(text) || casualLowercase)))
	) {
		artifacts.push("human-conversational")
	}

	const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []
	if (words.length >= 20 && new Set(words).size / words.length < 0.4) {
		artifacts.push("low-lexical-diversity")
	}

	const fingerprint =
		text.length >= 80
			? createHmac("sha256", key)
					.update(`${guildId}:${authorId}:`)
					.update(text.toLowerCase())
					.digest("hex")
			: createHmac("sha256", key)
					.update(`${guildId}:${authorId}:short:${text.length}`)
					.digest("hex")

	return {
		contentLength: text.length,
		lineCount,
		fingerprint,
		artifacts
	}
}
