import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameState } from '@landlord/engine';
import { cueOf, plan, type Beat, type Sound } from './playback';
import { playSound } from './sounds';

const TUMBLE_FRAMES = 7;
const TUMBLE_MS = 113;
const DICE_HOLD_MS = 375;
const STEP_MS = 200;
/** A long card move (round the Board to GO) walks faster rather than holding up the game. */
const MAX_WALK_MS = 3750;

type Frame = { ms: number; run: () => void };

export type Playback = {
  /** Where to draw tokens that are still walking; everyone else is where the state says. */
  positions: Record<string, number>;
  /** Faces to show while the dice tumble, or null when they show the last roll. */
  tumbling: number[] | null;
  /** True while dice or tokens are animating, so prompts can wait for the token to arrive. */
  busy: boolean;
};

/**
 * Plays the new log entries of `game` as dice and token animations with sound cues. With
 * `animate` off, sounds still play but tokens jump straight to where they are.
 */
export function usePlayback(game: GameState, me: string, animate: boolean, sound: boolean): Playback {
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [tumbling, setTumbling] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const lastSeq = useRef(game.log.at(-1)?.seq ?? -1);
  const frames = useRef<Frame[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const settings = useRef({ animate, sound });
  settings.current = { animate, sound };

  const cue = (s: Sound | null) => {
    if (s && settings.current.sound) playSound(s);
  };

  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    frames.current = [];
    setPositions({});
    setTumbling(null);
    setBusy(false);
  };

  const next = () => {
    const frame = frames.current.shift();
    if (!frame) return stop();
    frame.run();
    timer.current = setTimeout(next, frame.ms);
  };

  const toFrames = (beat: Beat): Frame[] => {
    if (beat.kind === 'sound') return [{ ms: 0, run: () => cue(cueOf(beat)) }];
    if (beat.kind === 'dice') {
      const face = () => 1 + Math.floor(Math.random() * game.rules.diceSides);
      return [
        ...Array.from({ length: TUMBLE_FRAMES }, (_, i) => ({
          ms: TUMBLE_MS,
          run: () => {
            if (i === 0) cue(cueOf(beat));
            setTumbling(beat.dice.map(face));
          },
        })),
        { ms: DICE_HOLD_MS, run: () => setTumbling(null) },
      ];
    }
    const ms = Math.min(STEP_MS, MAX_WALK_MS / Math.max(1, beat.path.length));
    return beat.path.map((at) => ({
      ms,
      run: () => {
        cue('step');
        setPositions((p) => ({ ...p, [beat.playerId]: at }));
      },
    }));
  };

  // Before paint, so a new state never flashes its prompt or a token's destination ahead of the walk.
  useLayoutEffect(() => {
    const fresh = game.log.filter((e) => e.seq > lastSeq.current).map((e) => e.event);
    lastSeq.current = game.log.at(-1)?.seq ?? -1;
    if (fresh.length === 0) return;
    // An Undo puts tokens back where they were: drop any walk still to come.
    if (fresh.some((e) => e.type === 'UNDONE')) return stop();
    const beats = plan(fresh, game.board.length, me);
    if (!settings.current.animate) {
      beats.forEach((beat) => cue(cueOf(beat)));
      return;
    }
    // Walking tokens stay where they started until their turn in the queue comes.
    const starts: Record<string, number> = {};
    for (const event of fresh) {
      if (event.type === 'MOVED' && !(event.playerId in starts)) starts[event.playerId] = event.from;
    }
    setPositions((p) => ({ ...starts, ...p }));
    frames.current.push(...beats.flatMap(toFrames));
    setBusy(true);
    if (timer.current === undefined) next();
  }, [game.log]);

  // Turning animations off mid-walk jumps every token to where it is.
  useEffect(() => {
    if (!animate) stop();
  }, [animate]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { positions, tumbling, busy };
}
