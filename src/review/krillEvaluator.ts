import { reviewConfig } from "../config/review.js"
import type { AnalysisReport, KrillEvaluation } from "./types.js"

interface KrillEvaluationResponse {
	automationProbability: number
	confidence: "high" | "moderate" | "low"
	brief: string
	disposition: "confirmed_bot" | "likely_bot" | "uncertain" | "likely_human"
	recommendedAction: "apply_bot_role" | "watchlist" | "dismiss"
}

export async function evaluateWithKrill(
	report: AnalysisReport,
	apiKey?: string
): Promise<KrillEvaluation | null> {
	const key = apiKey || process.env.OPENAI_API_KEY
	if (!key) {
		return null
	}

	const signalsSummary = report.signals
		.map(
			(s) =>
				`- [${s.family}] ${s.code}: ${s.description} (Metrics: ${JSON.stringify(s.metrics)})`
		)
		.join("\n")

	const systemPrompt = `You are Krill, the OpenClaw AI community verification engine powered by gpt-6 astra low-thinking.
Your role is to evaluate whether a flagged Discord account in the 175,000-member OpenClaw community is an automated agent (bot) or a human user.
You are given deterministic behavioral telemetry, timing statistics, and stylometric features.

Analyze the evidence impartially and provide an estimated assessment in JSON format:
{
  "automationProbability": <number between 0.00 and 1.00 representing model-estimated assessment probability>,
  "confidence": <"high" | "moderate" | "low">,
  "brief": <concise 2-3 sentence factual briefing explaining why the user was or wasn't flagged and the key behavioral traits>,
  "disposition": <"confirmed_bot" | "likely_bot" | "uncertain" | "likely_human">,
  "recommendedAction": <"apply_bot_role" | "watchlist" | "dismiss">
}

Guidelines:
- Superhuman pacing (e.g. >= 40 chars/sec, < 2.5s reply latency on large messages) and synthetic thought streams (e.g. "> 🧠 Thinking Process") strongly indicate an agent.
- A single behavioral family (e.g. only semantic similarity or only occasional lists) with human conversational slang (e.g. "idk", "tbh", "lol") is likely human.
- Multi-family concordance (timing + operational + stylometry) with consistent formatting and high velocity indicates an autonomous agent.
- Keep the brief objective, professional, and directly actionable for Discord moderators.`

	const userPrompt = `Subject Account: <@${report.subject.authorId}>
Guild: ${report.subject.guildId}
Sample Window: ${new Date(report.window.startAt).toISOString()} to ${new Date(report.window.endAt).toISOString()}
Sample Size: ${report.sample.messages} messages across ${report.sample.channels} channels (Span: ${(report.sample.spanMs / 3600000).toFixed(1)} hours)
Heuristic Score: ${report.heuristicScore ?? 0}/100
Concordance: ${report.concordance} (${Object.keys(report.familyScores).join(", ") || "None"})
Priority: ${report.priority}

Signals Triggered:
${signalsSummary || "None"}

Limitations / Counter-Indicators:
${report.limitations.map((l) => `- ${l}`).join("\n")}`

	const tryModel = async (
		modelName: string,
		withReasoning = true
	): Promise<KrillEvaluation | null> => {
		const controller = new AbortController()
		const timer = setTimeout(
			() => controller.abort(),
			reviewConfig.krill.timeoutMs
		)

		try {
			const bodyPayload: Record<string, unknown> = {
				model: modelName,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt }
				],
				response_format: { type: "json_object" },
				temperature: 0.1
			}

			if (withReasoning) {
				bodyPayload.reasoning_effort = reviewConfig.krill.reasoningEffort
			}

			const res = await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${key}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify(bodyPayload),
				signal: controller.signal
			})

			if (!res.ok) {
				const errorText = await res.text()
				console.warn(`Krill evaluation failed on model ${modelName}:`, errorText)
				return null
			}

			const data = (await res.json()) as {
				choices?: Array<{ message?: { content?: string } }>
			}
			const rawContent = data.choices?.[0]?.message?.content
			if (!rawContent) return null

			const parsed = JSON.parse(rawContent) as KrillEvaluationResponse
			return {
				automationProbability: Math.min(
					1,
					Math.max(0, parsed.automationProbability ?? 0.5)
				),
				confidence: parsed.confidence || "moderate",
				brief: parsed.brief || "No brief generated.",
				disposition: parsed.disposition || "uncertain",
				recommendedAction: parsed.recommendedAction || "watchlist",
				model: modelName,
				evaluatedAt: new Date().toISOString()
			}
		} catch (err) {
			console.warn(`Error during Krill evaluation with ${modelName}:`, err)
			return null
		} finally {
			clearTimeout(timer)
		}
	}

	// First try gpt-6-astra with low reasoning effort
	let result = await tryModel(reviewConfig.krill.model, true)
	if (!result) {
		// Fallback to secondary model without reasoning_effort
		result = await tryModel(reviewConfig.krill.fallbackModel, false)
	}

	return result
}
