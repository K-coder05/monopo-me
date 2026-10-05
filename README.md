# monopo-me

Landlord: an online property-trading board game for one friend group, where the Host can rewrite the rules mid-game. See `docs/build-spec.md` and `CONTEXT.md`.

Needs Node.js 20 or later.

## Run locally

```sh
npm install
npm run dev
```

This starts the game server on port 3001 and the client on http://localhost:5173. Friends on the same network can join with your machine's address on port 5173.

- `npm test` runs the engine, server and client tests (Vitest).
- `npm run typecheck` typechecks every package.

## Run in production

```sh
npm install
npm run build
npm start
```

`npm run build` builds the client into `packages/client/dist` and bundles the server into `packages/server/dist`. `npm start` then runs one Node process that serves the client and the websocket on `PORT` (default 3001): open http://localhost:3001.

Settings, all optional, as environment variables:

| Variable | Default | What it is |
| --- | --- | --- |
| `PORT` | `3001` | Port the server listens on. Hosts usually set this for you. |
| `DATA_DIR` | `./data/rooms` | Where Rooms are saved |
| `PRESETS_DIR` | `./data/presets` | Where Presets are saved |
| `CLIENT_DIR` | `packages/client/dist` | The built client to serve |

## Play over the internet

### From your own machine, through a tunnel

Run the production build as above, then expose port 3001 with a tunnel, for example:

```sh
cloudflared tunnel --url http://localhost:3001
# or
ngrok http 3001
```

Share the https address the tunnel prints. Rooms are saved on your machine and survive restarts.

### On a free host

Any host that runs a Node web service with websockets works. Use these settings:

- **Build command:** `npm install && npm run build` (dev dependencies are needed for the build, so do not set `NODE_ENV=production` during it)
- **Start command:** `npm start`
- **Health check path:** `/health`

Host notes:

- **Render:** create a Web Service from the repo with the commands above. Free instances sleep when idle and take a few seconds to wake.
- **Railway:** create a service from the repo; set the build and start commands above under Settings, then generate a public domain.
- **Fly.io:** `fly launch` detects Node; set the build and start commands above, keep `internal_port` matching `PORT` (3001 unless you change it).

Free hosts usually have no lasting disk: Rooms and Presets are lost when the instance restarts or redeploys. Attach a persistent disk or volume and point `DATA_DIR` and `PRESETS_DIR` at it to keep them, or export Presets you care about.

## Layout

- `packages/engine`: pure rules engine, `(state, action, rules, rng) => { state, events }`, plus the Defaults and the shared socket protocol types
- `packages/server`: Express + Socket.IO; binds each connection to one Player, runs the engine and serves the built client
- `packages/client`: React + Vite

## Persistence

Rooms are saved as one JSON file each in `DATA_DIR` (default `./data/rooms`, relative to where the server starts) and reloaded on startup. Rooms idle for 30 days are deleted.
