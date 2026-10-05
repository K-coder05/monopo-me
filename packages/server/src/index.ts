import { createServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  IllegalActionError,
  toPreset,
  viewFor,
  type Ack,
  type ActionResult,
  type ClientToServer,
  type JoinedRoom,
  type RejoinKey,
  type PropertyIntent,
  type TradeSide,
  type ServerToClient,
} from '@landlord/engine';
import { Presets } from './presets';
import { Rooms } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data', 'rooms');
const PRESETS_DIR = process.env.PRESETS_DIR ?? join(process.cwd(), 'data', 'presets');

/** The one Player this connection controls (ADR 0001). */
type SocketData = { player?: JoinedRoom };
type GameSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(httpServer);
const rooms = new Rooms(broadcast, undefined, undefined, DATA_DIR);
const presets = new Presets(PRESETS_DIR);
setInterval(() => rooms.expireIdle(), 60 * 60 * 1000).unref();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** Sends each connection in the Room the state as its Player may see it (hidden Decks stay with the Host). */
function broadcast(roomCode: string, { state, events }: ActionResult) {
  const serverNow = Date.now();
  const away = rooms.away(roomCode);
  for (const id of io.sockets.adapter.rooms.get(roomCode) ?? []) {
    const socket = io.sockets.sockets.get(id);
    socket?.emit('STATE', { state: viewFor(state, socket.data.player?.playerId), events, serverNow, away });
  }
}

/** Runs `fn`, reporting illegal actions back to the sender instead of crashing. */
function handle<T extends object>(ack: Ack<T> | undefined, fn: () => T) {
  const reply: Ack<T> = typeof ack === 'function' ? ack : () => {};
  try {
    reply({ ok: true, ...fn() });
  } catch (err) {
    if (err instanceof IllegalActionError) {
      reply({ ok: false, error: err.message });
    } else {
      console.error(err);
      reply({ ok: false, error: 'Something went wrong on the server' });
    }
  }
}

function requirePlayer(socket: GameSocket): JoinedRoom {
  const player = socket.data.player;
  if (!player) throw new IllegalActionError('Join a Room first');
  return player;
}

/** For server-side Host powers the engine never sees, such as reading and writing saved Presets. */
function requireHost(socket: GameSocket): JoinedRoom {
  const player = requirePlayer(socket);
  if (rooms.get(player.roomCode)?.hostId !== player.playerId) throw new IllegalActionError('Only the Host can do that');
  return player;
}

function requireNoPlayer(socket: GameSocket) {
  // Each connection controls exactly one Player (ADR 0001).
  if (socket.data.player) throw new IllegalActionError('This connection is already in a Room');
}

/** Binds the connection to its Player, subscribes it to the Room and broadcasts the Room's state. */
function bind(socket: GameSocket, { roomCode, playerId }: JoinedRoom, result: ActionResult) {
  socket.data.player = { roomCode, playerId };
  rooms.connect(roomCode, playerId);
  void socket.join(roomCode);
  broadcast(roomCode, { state: rooms.get(roomCode)!, events: result.events });
}

/** Cuts every connection of a Player or Spectator who left or was kicked loose from the Room. */
function unbind(roomCode: string, playerId: string, kicked: boolean) {
  for (const id of [...(io.sockets.adapter.rooms.get(roomCode) ?? [])]) {
    const socket = io.sockets.sockets.get(id);
    if (socket?.data.player?.playerId !== playerId) continue;
    socket.data.player = undefined;
    void socket.leave(roomCode);
    socket.emit('REMOVED', { kicked });
  }
}

function bindNew(socket: GameSocket, result: RejoinKey & ActionResult): RejoinKey {
  bind(socket, result, result);
  return { roomCode: result.roomCode, playerId: result.playerId, token: result.token };
}

/** Coerces untrusted socket input into a TradeSide; the engine checks the values. */
function toTradeSide(raw: Partial<TradeSide> | undefined): TradeSide {
  const list = <T>(items: unknown, keep: (x: unknown) => x is T): T[] => (Array.isArray(items) ? items.filter(keep) : []);
  return {
    cash: Number(raw?.cash ?? 0),
    properties: list(raw?.properties, (x): x is number => typeof x === 'number'),
    cards: list(raw?.cards, (x): x is string => typeof x === 'string'),
  };
}

io.on('connection', (socket: GameSocket) => {
  socket.on('CREATE_ROOM', (msg, ack) =>
    handle(ack, () => {
      requireNoPlayer(socket);
      return bindNew(socket, rooms.create(msg?.name, msg?.color));
    }),
  );

  socket.on('JOIN_ROOM', (msg, ack) =>
    handle(ack, () => {
      requireNoPlayer(socket);
      return bindNew(socket, rooms.join(String(msg?.roomCode ?? ''), msg?.name, msg?.color));
    }),
  );

  socket.on('REJOIN_ROOM', (msg, ack) =>
    handle(ack, () => {
      requireNoPlayer(socket);
      const roomCode = String(msg?.roomCode ?? '').trim().toUpperCase();
      const playerId = rooms.rejoin(roomCode, msg?.token);
      bind(socket, { roomCode, playerId }, { state: rooms.get(roomCode)!, events: [] });
      return { roomCode, playerId };
    }),
  );

  socket.on('disconnect', () => {
    const player = socket.data.player;
    if (!player) return;
    rooms.disconnect(player.roomCode, player.playerId);
    const state = rooms.get(player.roomCode);
    if (state) broadcast(player.roomCode, { state, events: [] });
  });

  // Intents act for the Player bound to this connection; any playerId in the payload is ignored.
  for (const type of [
    'START_GAME',
    'ROLL_DICE',
    'PAY_JAIL_FINE',
    'USE_JAIL_CARD',
    'BUY_PROPERTY',
    'DECLINE_PROPERTY',
    'PASS_AUCTION',
    'END_TURN',
    'ACCEPT_TRADE',
    'REJECT_TRADE',
    'WITHDRAW_TRADE',
    'PAY_DEBT',
    'DECLARE_BANKRUPTCY',
    'REMATCH',
    'BACK_TO_LOBBY',
    'RESET_TO_DEFAULTS',
    'PAUSE',
    'RESUME',
    'END_GAME',
  ] as const) {
    socket.on(type, (_msg, ack) =>
      handle(ack, () => {
        const { roomCode, playerId } = requirePlayer(socket);
        broadcast(roomCode, rooms.act(roomCode, { type, playerId }));
        return {};
      }),
    );
  }

  // The engine checks the sender is the Host and validates every value.
  socket.on('UPDATE_RULES', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'UPDATE_RULES', playerId, changes: msg?.changes ?? {} }));
      return {};
    }),
  );

  socket.on('UPDATE_BOARD', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'UPDATE_BOARD', playerId, edits: msg?.edits ?? [] }));
      return {};
    }),
  );

  // Card editor: the engine checks the sender is the Host and validates every field and Effect.
  socket.on('ADD_CARD', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'ADD_CARD', playerId, deck: msg?.deck, card: msg?.card }));
      return {};
    }),
  );

  socket.on('EDIT_CARD', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      const action = { type: 'EDIT_CARD', playerId, cardId: msg?.cardId, card: msg?.card, held: msg?.held } as const;
      broadcast(roomCode, rooms.act(roomCode, action));
      return {};
    }),
  );

  socket.on('DELETE_CARD', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'DELETE_CARD', playerId, cardId: msg?.cardId, held: msg?.held }));
      return {};
    }),
  );

  for (const type of ['RESET_DECK', 'SHUFFLE_DECK'] as const) {
    socket.on(type, (msg, ack) =>
      handle(ack, () => {
        const { roomCode, playerId } = requirePlayer(socket);
        broadcast(roomCode, rooms.act(roomCode, { type, playerId, deck: msg?.deck }));
        return {};
      }),
    );
  }

  socket.on('HIDE_DECK_CONTENTS', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'HIDE_DECK_CONTENTS', playerId, hidden: msg?.hidden }));
      return {};
    }),
  );

  // Presets live on the server, outside any Room; the engine checks every value on save, import and load.
  socket.on('LIST_PRESETS', (_msg, ack) =>
    handle(ack, () => {
      requireHost(socket);
      return { names: presets.list() };
    }),
  );

  socket.on('SAVE_PRESET', (msg, ack) =>
    handle(ack, () => {
      const { roomCode } = requireHost(socket);
      presets.save(toPreset(rooms.get(roomCode)!, msg?.name));
      return {};
    }),
  );

  socket.on('LOAD_PRESET', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requireHost(socket);
      const preset = presets.get(String(msg?.name ?? ''));
      broadcast(roomCode, rooms.act(roomCode, { type: 'LOAD_PRESET', playerId, preset }));
      return {};
    }),
  );

  socket.on('EXPORT_PRESET', (msg, ack) =>
    handle(ack, () => {
      requireHost(socket);
      return { preset: presets.get(String(msg?.name ?? '')) };
    }),
  );

  socket.on('IMPORT_PRESET', (msg, ack) =>
    handle(ack, () => {
      requireHost(socket);
      return { name: presets.save(msg?.preset).name };
    }),
  );

  // The engine checks the sender is the Host and validates the Override.
  socket.on('HOST_OVERRIDE', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'HOST_OVERRIDE', playerId, override: msg?.override }));
      return {};
    }),
  );

  socket.on('UNDO', (_msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.undo(roomCode, playerId));
      return {};
    }),
  );

  socket.on('LEAVE_ROOM', (_msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      const result = rooms.act(roomCode, { type: 'LEAVE_ROOM', playerId });
      unbind(roomCode, playerId, false);
      broadcast(roomCode, result);
      return {};
    }),
  );

  // The engine checks the sender is the Host and that the target is in the Room.
  socket.on('KICK', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      const targetId = String(msg?.targetId ?? '');
      const result = rooms.act(roomCode, { type: 'KICK', playerId, targetId });
      unbind(roomCode, targetId, true);
      broadcast(roomCode, result);
      return {};
    }),
  );

  socket.on('TRANSFER_HOST', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'TRANSFER_HOST', playerId, toId: String(msg?.playerId ?? '') }));
      return {};
    }),
  );

  socket.on('ADD_PLAYER', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'ADD_PLAYER', playerId, spectatorId: String(msg?.spectatorId ?? '') }));
      return {};
    }),
  );

  // The engine validates the amount (whole number, above the current bid, within cash).
  socket.on('PLACE_BID', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      broadcast(roomCode, rooms.act(roomCode, { type: 'PLACE_BID', playerId, amount: Number(msg?.amount) }));
      return {};
    }),
  );

  // The engine validates who may continue the card and that `choiceId` names a Player in the game.
  socket.on('CONTINUE_CARD', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      const choiceId = typeof msg?.choiceId === 'string' ? msg.choiceId : undefined;
      broadcast(roomCode, rooms.act(roomCode, { type: 'CONTINUE_CARD', playerId, choiceId }));
      return {};
    }),
  );

  // The engine validates who may propose, what is on offer and whether the Players can afford it.
  socket.on('PROPOSE_TRADE', (msg, ack) =>
    handle(ack, () => {
      const { roomCode, playerId } = requirePlayer(socket);
      const partnerId = String(msg?.partnerId ?? '');
      const give = toTradeSide(msg?.give);
      const take = toTradeSide(msg?.take);
      broadcast(roomCode, rooms.act(roomCode, { type: 'PROPOSE_TRADE', playerId, partnerId, give, take }));
      return {};
    }),
  );

  // The engine validates the index (a street the Player owns, built or sold evenly; a property to
  // mortgage or unmortgage).
  const propertyIntents: PropertyIntent[] = ['BUILD', 'SELL_BUILDING', 'MORTGAGE', 'UNMORTGAGE'];
  for (const type of propertyIntents) {
    socket.on(type, (msg, ack) =>
      handle(ack, () => {
        const { roomCode, playerId } = requirePlayer(socket);
        broadcast(roomCode, rooms.act(roomCode, { type, playerId, index: Number(msg?.index) }));
        return {};
      }),
    );
  }
});

httpServer.listen(PORT, () => {
  console.log(`Landlord server listening on http://localhost:${PORT}`);
});
