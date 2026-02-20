# wopr-plugin-twitch

`@wopr-network/wopr-plugin-twitch` -- Twitch channel plugin for WOPR.

## Commands

```bash
npm run build     # tsc
npm run dev       # tsc --watch
npm run check     # biome check + tsc --noEmit (run before committing)
npm run lint:fix  # biome check --fix src/
npm run format    # biome format --write src/
npm test          # vitest run
```

**Linter/formatter is Biome.** Never add ESLint/Prettier config.

## Architecture

```
src/
  index.ts              # Plugin entry -- exports WOPRPlugin default
  channel-provider.ts   # Implements ChannelProvider interface
  chat-client.ts        # Twurple ChatClient wrapper + message handling
  eventsub.ts           # EventSub WebSocket for channel point redemptions
  rate-limiter.ts       # Token bucket rate limiter for Twitch IRC
  role-mapper.ts        # Map Twitch badges to WOPR roles
  types.ts              # Plugin-local types + re-exports from plugin-types
```

## Plugin Contract

This plugin imports ONLY from `@wopr-network/plugin-types` -- never from wopr core internals.

## Key Details

- **SDK**: Twurple (`@twurple/auth`, `@twurple/chat`, `@twurple/api`, `@twurple/eventsub-ws`)
- Implements `ChannelProvider` from `@wopr-network/plugin-types`
- OAuth token + client ID/secret configured via plugin config schema
- Rate limiting: 20 msg/30s (regular), 100 msg/30s (mod)
- Channel points via EventSub WebSocket (optional)
- Whispers supported (optional, default enabled)

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-twitch`.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.