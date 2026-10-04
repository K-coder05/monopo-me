# monopo-me

Landlord: an online property-trading board game for one friend group, where the Host can rewrite the rules mid-game. See `docs/build-spec.md` and `CONTEXT.md`.

## Run locally

```sh
npm install
npm run dev
```

This starts the game server on port 3001 and the client on http://localhost:5173. Friends on the same network can join with your machine's address on port 5173.

- `npm test` runs the engine tests (Vitest).
- `npm run typecheck` typechecks every package.

## Layout

- `packages/engine`: pure rules engine, `(state, action, rules, rng) => { state, events }`, plus the Defaults and the shared socket protocol types
- `packages/server`: Express + Socket.IO; binds each connection to one Player and runs the engine
- `packages/client`: React + Vite
