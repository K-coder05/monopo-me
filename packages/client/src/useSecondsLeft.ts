import { useEffect, useState } from 'react';

/** Seconds left until `endsAt` on the server clock, re-rendering as it counts down. */
export function useSecondsLeft(endsAt: number, clockOffset: number): number {
  const left = () => Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset)) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const id = setInterval(() => setSeconds(left()), 250);
    return () => clearInterval(id);
  }, [endsAt, clockOffset]);
  return seconds;
}
