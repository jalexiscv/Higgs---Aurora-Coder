# Aurora CLI Reference

Live sources when anything looks stale: `aurora --help`, `aurora <command> --help`,
https://hermes-agent.nousresearch.com/docs/reference/cli-commands

### Global Flags

```
aurora [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
aurora chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
aurora setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
aurora model                Interactive model/provider picker
aurora fallback [add|remove|list]  Fallback provider chain
aurora config [show|edit|get|set|unset|path|env-path|check|migrate]
aurora login / logout       OAuth sign-in / clear stored auth
aurora doctor [--fix]       Check dependencies and config
aurora status [--full]      Component summary (--full: every section)
```

### Tools & Skills

```
aurora tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

aurora skills list|browse|search QUERY|inspect ID
aurora skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
aurora skills config        Enable/disable skills per platform
aurora skills check|update|uninstall|publish PATH
aurora skills tap add REPO  Add a GitHub repo as a skill source
aurora bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
aurora mcp add NAME (--url or --command) | remove | list | test NAME
aurora mcp catalog | install NAME     Curated catalog install
aurora mcp configure NAME             Toggle tool selection
aurora mcp-serve                      Run Aurora as an MCP server (mcp-serve plugin)
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
aurora gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `aurora photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/

### Sessions

```
aurora sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
aurora cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
aurora webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
aurora profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
aurora profile rename A B | alias NAME | export NAME | import FILE
aurora profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
aurora auth                 Interactive credential manager
aurora auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
aurora auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
aurora desktop / gui        Native desktop app
aurora dashboard            Web admin panel + embedded chat (--stop / --status)
aurora proxy                OpenAI-compatible local proxy backed by an OAuth provider
aurora portal               Quick setup / sign in via Nous Portal
aurora kanban <verb>        Multi-agent work-queue board
aurora project              Named multi-folder workspaces (see references/projects-and-folders.md)
aurora skin list|use|set    Switch/tweak skins (see references/themes.md)
aurora pets <verb>          Pet mascots (see references/petdex.md)
aurora memory setup|status|off|reset   Memory provider
aurora secrets bitwarden|onepassword   External secret stores
aurora moa                  Mixture-of-Agents slots
aurora hooks / security / backup / import / checkpoints / console
aurora logs [-f] [errors]   View agent/error logs
aurora send                 One-off message through a gateway platform
aurora pairing / plugins / insights / journey / computer-use
aurora acp                  ACP server (IDE integration)
aurora completion bash|zsh|fish
aurora update / uninstall
```

Plugin- and provider-supplied subcommands (e.g. `aurora photon setup`) only appear once their plugin is installed/active. Importing from OpenClaw, Claude Code, Codex CLI or Cursor (`aurora import-agent <agent>`, plus the older `aurora claw migrate|cleanup`) comes from the `agent-importers` plugin; a fresh `aurora setup` that finds one of those agents offers to install it.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `aurora config edit` · [Configuration docs](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) |
| Tools / toolsets | `aurora tools list` · [Tools reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference) |
| Skills catalog | `aurora skills browse` · [Skills catalog](https://hermes-agent.nousresearch.com/docs/reference/skills-catalog) |
| Provider setup | `aurora model` · [Providers guide](https://hermes-agent.nousresearch.com/docs/integrations/providers) |
| Env variables | `aurora config env-path` · [Env vars reference](https://hermes-agent.nousresearch.com/docs/reference/environment-variables) |
| Gateway logs | `~/.aurora/logs/gateway.log` (or `aurora logs`) |
| Sessions | `aurora sessions browse` (reads state.db) |
