import { defineConfig } from "drizzle-kit"

export default defineConfig({
	dialect: "sqlite",
	schema: ["./src/db/schema.ts", "./src/db/archived-society.ts", "./src/db/archived-reddit.ts"],
	out: "./drizzle"
})
