import { Database } from "bun:sqlite"

const d1Result = <T>(results: T[]) => ({
	success: true,
	results,
	meta: {}
})

class SqliteD1PreparedStatement {
	constructor(
		private readonly owner: SqliteD1Database,
		private readonly query: string,
		private readonly params: unknown[] = []
	) {}

	bind(...values: unknown[]) {
		return new SqliteD1PreparedStatement(this.owner, this.query, values)
	}

	async run() {
		await this.owner.run(this.query, this.params)
		return d1Result([])
	}

	async all<T = Record<string, unknown>>() {
		return d1Result(
			this.owner.database.query(this.query).all(...this.params) as T[]
		)
	}

	async raw<T = unknown[]>() {
		return this.owner.database.query(this.query).values(...this.params) as T[]
	}

	async first<T = Record<string, unknown>>(columnName?: string) {
		const first = this.owner.database.query(this.query).get(...this.params) as
			| Record<string, unknown>
			| null
		if (!first || !columnName) {
			return first as T | null
		}
		return (first[columnName] ?? null) as T | null
	}
}

export class SqliteD1Database {
	readonly database: Database
	private transactionTail = Promise.resolve()
	private releaseTransaction: (() => void) | null = null

	constructor(path = ":memory:") {
		this.database = new Database(path)
	}

	prepare(query: string) {
		return new SqliteD1PreparedStatement(this, query)
	}

	async batch<T = unknown>(statements: SqliteD1PreparedStatement[]) {
		const results = []
		await this.run("begin immediate", [])
		try {
			for (const statement of statements) {
				results.push(await statement.all<T>())
			}
			await this.run("commit", [])
			return results
		} catch (error) {
			await this.run("rollback", [])
			throw error
		}
	}

	async exec(query: string) {
		this.database.exec(query)
		return { count: 0, duration: 0 }
	}

	withSession() {
		return this
	}

	async run(query: string, params: unknown[]) {
		const normalized = query.trim().toLowerCase()
		if (normalized.startsWith("begin")) {
			const previous = this.transactionTail
			let release = () => {}
			this.transactionTail = new Promise<void>((resolve) => {
				release = resolve
			})
			await previous
			this.releaseTransaction = release
			try {
				this.database.query(query).run(...params)
			} catch (error) {
				this.releaseTransaction = null
				release()
				throw error
			}
			return
		}

		if (normalized === "commit" || normalized === "rollback") {
			try {
				this.database.query(query).run(...params)
			} finally {
				this.releaseTransaction?.()
				this.releaseTransaction = null
			}
			return
		}

		this.database.query(query).run(...params)
	}

	close() {
		this.database.close()
	}
}
