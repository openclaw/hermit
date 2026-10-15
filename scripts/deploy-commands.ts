import { client } from "../src/index.js"

// Carbon reconciles global commands but still overwrites guild commands.
// Keep this operation explicit instead of repeating it in each Worker isolate.
await client.deployCommands({ mode: "reconcile" })
console.log("Discord commands deployed.")
