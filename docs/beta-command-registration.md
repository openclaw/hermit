# Explicit Beta Pings registration

The staff-only /beta-pings command also ensures its companion /beta command exists before posting the public toggle menu. It is the only runtime registration trigger: ordinary Worker requests, cron, public /beta and button interactions do not register commands.

## Safety boundaries

- The signed interaction must come from the configured guild, and its member permission bitset must include Manage Roles or Administrator. Missing/malformed permissions fail closed, independently of Discord's configurable default command permissions.
- Carbon defers /beta-pings privately. The command edits that private acknowledgement before sending the successful menu as a separate public Carbon followup. Registration/auth/conflict failures never send a public menu.
- Use the existing bot REST client, with its existing queueRequests:false (automatic 429 retries disabled) and default 15-second request timeout. Refuse registration if queued retries become enabled.
- GET the configured application's guild commands on every new explicit invocation. A matching /beta is read-only; unexpected /beta metadata fails privately, never overwrites. Discord's guild API may omit global-only contexts/integration_types; if supplied they must match. Ignore unrelated commands.
- Only create a missing /beta, using BetaCommand.serialize() verbatim. No bulk PUT, reconciliation, application-wide changes, or automatic POST retry.

## Concurrency and uncertain outcomes

An app+guild singleflight coalesces simultaneous calls in one isolate. Before creating, atomically insert a namespaced intent in the existing D1 keyValue table, then GET again under that guard. A competing isolate fails privately rather than posting.

The intent has **no expiry and is not automatically deleted**, even on timeout or failure before POST. A lease expiry would permit a paused/queued old writer to wake after a replacement writer. Future explicit invocations always GET: if the command is now correct they can safely post the menu; if still missing, they report the retained intent and do not blindly retry creation. This intentionally sacrifices automatic recovery, including recreation after later deletion, for at-most-one creation attempt by Hermit. An operator must inspect Discord and the original attempt and establish that no writer can still run before deliberately resetting registration state. No reset command or automatic reset is provided here. No migration is needed.

Discord's command-create endpoint is an upsert by name, not a conditional create. An external administrator or another bot process not using this guard can race the final GET and POST. The guard prevents duplicate attempts among participating Hermit isolates, but cannot provide a Discord-side compare-and-swap. Observed conflicts stop privately; post-write GET confirms resulting metadata but cannot retroactively prevent an unseen external race. External edits can also happen after any successful GET. Registration success is not proof of live role-toggle behavior.

No live Discord calls are used in the tests; real Carbon dispatch is exercised with stubbed REST methods to verify private defer (64), private Components V2 acknowledgement (32832), and public Components V2 followup (32768).
