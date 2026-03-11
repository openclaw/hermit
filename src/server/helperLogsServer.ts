import {
	listEvents,
	listTrackedThreads,
} from "../data/helperLogs.js"

let serverStarted = false

const asStringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const json = (data: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(data), {
		...init,
	headers: {
			"content-type": "application/json; charset=utf-8",
			...init?.headers
		}
	})

const renderHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Worker Events</title>
    <style>
      :root {
        --bg: #f5f7fb;
        --panel: #ffffff;
        --text: #1b2330;
        --muted: #5d6b82;
        --border: #dbe2ee;
        --accent: #1b6fff;
        --accent-2: #0f4dcf;
        --shadow: 0 10px 30px rgba(25, 40, 70, 0.08);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 10% 10%, #dbe8ff 0%, transparent 40%),
          radial-gradient(circle at 90% 20%, #e7f0ff 0%, transparent 35%),
          var(--bg);
      }

      .wrap {
        max-width: 1280px;
        margin: 0 auto;
        padding: 28px 16px 40px;
      }

      .header {
        margin-bottom: 18px;
      }

      h1 {
        margin: 0 0 6px;
        font-size: 1.8rem;
      }

      .subtitle {
        margin: 0;
        color: var(--muted);
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        box-shadow: var(--shadow);
      }

      .filters {
        padding: 14px;
        display: grid;
        grid-template-columns: repeat(7, minmax(130px, 1fr));
        gap: 10px;
      }

      .filters label {
        font-size: 0.78rem;
        color: var(--muted);
        display: block;
        margin-bottom: 6px;
      }

      input, select, button {
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--border);
        padding: 9px 10px;
        font-size: 0.92rem;
        background: white;
      }

      button {
        background: var(--accent);
        color: white;
        border: none;
        cursor: pointer;
        font-weight: 600;
        transition: background 0.2s ease;
      }

      button:hover { background: var(--accent-2); }

      .button-row {
        display: flex;
        gap: 8px;
        align-items: end;
      }

      .button-row button:last-child {
        background: #eef3ff;
        color: #1d3f88;
      }

      .meta {
        padding: 0 14px 10px;
        font-size: 0.85rem;
        color: var(--muted);
      }

      .table-wrap {
        overflow: auto;
        border-top: 1px solid var(--border);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 1200px;
      }

      th, td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }

      th {
        background: #f8faff;
        position: sticky;
        top: 0;
        z-index: 1;
        font-size: 0.78rem;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: var(--muted);
      }

      tbody tr:hover {
        background: #f9fbff;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.84rem;
      }

      @media (max-width: 1100px) {
        .filters {
          grid-template-columns: repeat(2, minmax(140px, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <header class="header">
        <h1>Worker Events</h1>
        <p class="subtitle">Generic worker events captured from Hermit.</p>
      </header>

      <section class="panel">
        <div class="filters">
          <div>
            <label for="eventType">Event Type</label>
            <input id="eventType" placeholder="mark_solution" />
          </div>
          <div>
            <label for="command">Command</label>
            <input id="command" placeholder="Solved (Mod)" />
          </div>
          <div>
            <label for="threadId">Thread ID</label>
            <input id="threadId" placeholder="123..." />
          </div>
          <div>
            <label for="invokedBy">Invoker ID</label>
            <input id="invokedBy" placeholder="145..." />
          </div>
          <div>
            <label for="from">From (ISO)</label>
            <input id="from" placeholder="2026-03-01T00:00:00Z" />
          </div>
          <div>
            <label for="to">To (ISO)</label>
            <input id="to" placeholder="2026-03-06T23:59:59Z" />
          </div>
          <div>
            <label for="limit">Limit</label>
            <select id="limit">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>
          <div class="button-row">
            <button id="apply">Apply filters</button>
          </div>
          <div class="button-row">
            <button id="clear" type="button">Clear</button>
          </div>
        </div>
        <div class="meta" id="meta">Loading...</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Event Type</th>
                <th>Event Time</th>
                <th>Received</th>
                <th>Command</th>
                <th>Thread ID</th>
                <th>Message Count</th>
                <th>Invoker ID</th>
                <th>Invoker Username</th>
                <th>Invoker Global Name</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </section>
    </main>

    <script>
      const els = {
        eventType: document.getElementById("eventType"),
        command: document.getElementById("command"),
        threadId: document.getElementById("threadId"),
        invokedBy: document.getElementById("invokedBy"),
        from: document.getElementById("from"),
        to: document.getElementById("to"),
        limit: document.getElementById("limit"),
        apply: document.getElementById("apply"),
        clear: document.getElementById("clear"),
        rows: document.getElementById("rows"),
        meta: document.getElementById("meta")
      }

      const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")

      const buildParams = () => {
        const params = new URLSearchParams()
        const values = {
          eventType: els.eventType.value.trim(),
          command: els.command.value.trim(),
          threadId: els.threadId.value.trim(),
          invokedBy: els.invokedBy.value.trim(),
          from: els.from.value.trim(),
          to: els.to.value.trim(),
          limit: els.limit.value.trim()
        }

        for (const [key, value] of Object.entries(values)) {
          if (value) params.set(key, value)
        }

        return params
      }

      const renderRows = (rows) => {
        if (!rows.length) {
          els.rows.innerHTML = '<tr><td colspan="10">No matching events.</td></tr>'
          return
        }

        const html = rows.map((row) => {
          return '<tr>' +
            '<td class="mono">' + escapeHtml(row.id) + '</td>' +
            '<td>' + escapeHtml(row.event_type) + '</td>' +
            '<td class="mono">' + escapeHtml(row.event_time) + '</td>' +
            '<td class="mono">' + escapeHtml(row.received_at) + '</td>' +
            '<td>' + escapeHtml(row.command) + '</td>' +
            '<td class="mono">' + escapeHtml(row.thread_id ?? "") + '</td>' +
            '<td>' + escapeHtml(row.message_count ?? "") + '</td>' +
            '<td class="mono">' + escapeHtml(row.invoked_by_id ?? "") + '</td>' +
            '<td>' + escapeHtml(row.invoked_by_username ?? "") + '</td>' +
            '<td>' + escapeHtml(row.invoked_by_global_name ?? "") + '</td>' +
          '</tr>'
        }).join("")

        els.rows.innerHTML = html
      }

      const load = async () => {
        els.meta.textContent = "Loading..."
        const params = buildParams()
        const response = await fetch('/api/events?' + params.toString())

        if (!response.ok) {
          els.meta.textContent = 'Failed to load events (' + response.status + ')'
          els.rows.innerHTML = ""
          return
        }

        const data = await response.json()
        renderRows(data.events || [])
        els.meta.textContent = 'Showing ' + data.count + ' events'
      }

      els.apply.addEventListener("click", load)
      els.clear.addEventListener("click", () => {
        els.eventType.value = ""
        els.command.value = ""
        els.threadId.value = ""
        els.invokedBy.value = ""
        els.from.value = ""
        els.to.value = ""
        els.limit.value = "100"
        load()
      })

      load()
    </script>
  </body>
</html>`

const parsePort = () => {
	const rawPort = process.env.HELPER_LOGS_PORT?.trim()
	if (!rawPort) {
		return 8787
	}

	const port = Number.parseInt(rawPort, 10)
	if (!Number.isInteger(port) || port < 0) {
		console.warn(`Invalid HELPER_LOGS_PORT "${rawPort}". Falling back to 8787.`)
		return 8787
	}

	return port
}

export const startHelperLogsServer = () => {
	if (serverStarted) {
		return
	}

	const port = parsePort()
	if (port === 0) {
		console.log("Helper logs server disabled.")
		return
	}

	const hostname = process.env.HELPER_LOGS_HOST?.trim() || "127.0.0.1"

	Bun.serve({
		hostname,
		port,
		routes: {
			"/": {
				GET: () =>
					new Response(renderHtml(), {
						headers: {
							"content-type": "text/html; charset=utf-8"
						}
					})
			},
			"/api/events": {
				GET: async (request) => {
					const url = new URL(request.url)
					const events = await listEvents({
						eventType: asStringOrNull(url.searchParams.get("eventType")),
						command: asStringOrNull(url.searchParams.get("command")),
						threadId: asStringOrNull(url.searchParams.get("threadId")),
						invokedBy: asStringOrNull(url.searchParams.get("invokedBy")),
						from: asStringOrNull(url.searchParams.get("from")),
						to: asStringOrNull(url.searchParams.get("to")),
						limit:
							Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100
					})

					return json({ count: events.length, events })
				}
			},
			"/api/threads": {
				GET: async (request) => {
					const url = new URL(request.url)
					const threads = await listTrackedThreads({
						threadId: asStringOrNull(url.searchParams.get("threadId")),
						solved:
							url.searchParams.get("solved") === null
								? undefined
								: url.searchParams.get("solved") === "1" ||
									url.searchParams.get("solved")?.toLowerCase() === "true",
						closed:
							url.searchParams.get("closed") === null
								? undefined
								: url.searchParams.get("closed") === "1" ||
									url.searchParams.get("closed")?.toLowerCase() === "true",
						limit:
							Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100
					})

					return json({ count: threads.length, threads })
				}
			}
		},
		fetch: () => json({ error: "Not found" }, { status: 404 }),
		error: (error) => {
			console.error("Helper logs server error:", error)
			return json({ error: "Internal Server Error" }, { status: 500 })
		}
	})

	serverStarted = true
	console.log(`Helper logs server listening on http://${hostname}:${port}`)
}
