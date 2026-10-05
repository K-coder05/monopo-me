import { createServer } from 'node:http';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  IllegalActionError,
  type Ack,
  type ActionResult,
  type ClientToServer,
  type JoinedRoom,
  type PropertyIntent,
  type ServerToClient,
} from '@landlord/engine';
import { Rooms } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);

/** The one Player this connection controls (ADR 0001). */
type SocketData = { player?: JoinedRoom };
type GameSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(httpServer);
const rooms = new Rooms(broadcast);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function broadcast(roomCode: string, { state, events }: ActionResult) {
  io.to(roomCode).emit('STATE', { state, events, serverNow: Date.now() });
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

function requireNoPlayer(socket: GameSocket) {
  // Each connection controls exactly one Player (ADR 0001).
  if (socket.data.player) throw new IllegalActionError('This connection is already in a Room');
}

/** Binds the connection to its new Player, subscribes it to the Room and broadcasts the Room's state. */
function bindAndBroadcast(socket: GameSocket, result: JoinedRoom & ActionResult): JoinedRoom {
  socket.data.player = { roomCode: result.roomCode, playerId: result.playerId };
  void socket.join(result.roomCode);
  broadcast(result.roomCode, result);
  return socket.data.player;
}

io.on('connection', (socket: GameSocket) => {
  socket.on('CREATE_ROOM', (msg, ack) =>
    handle(ack, () => {
      requireNoPlayer(socket);
      return bindAndBroadcast(socket, rooms.create(msg?.name, msg?.color));
    }),
  );

  socket.on('JOIN_ROOM', (msg, ack) =>
    handle(ack, () => {
      requireNoPlayer(socket);
      return bindAndBroadcast(socket, rooms.join(String(msg?.roomCode ?? ''), msg?.name, msg?.color));
    }),
  );

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
    'PAY_DEBT',
    'DECLARE_BANKRUPTCY',
    'REMATCH',
    'BACK_TO_LOBBY',
  ] as const) {
    socket.on(type, (_msg, ack) =>
      handle(ack, () => {
        const { roomCode, playerId } = requirePlayer(socket);
        broadcast(roomCode, rooms.act(roomCode, { type, playerId }));
        return {};
      }),
    );
  }

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
