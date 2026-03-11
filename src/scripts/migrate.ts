import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { db } from "../db.js"

const migrationsFolder = Bun.env.DRIZZLE_MIGRATIONS ?? "drizzle"

migrate(db, { migrationsFolder })

console.log(`Applied migrations from ${migrationsFolder}.`)
