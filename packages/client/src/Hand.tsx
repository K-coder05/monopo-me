import { useLayoutEffect, useRef } from 'react';
import {
  groupHasBuildings,
  HOTEL,
  mortgageValue,
  unmortgageCost,
  type GameState,
  type PropertyIntent,
} from '@landlord/engine';
import { DECK_LABELS } from './cardLabels';
import { holdingsOf } from './holdings';
import { describeBuildings, groupColor } from './spaces';

type Props = {
  game: GameState;
  me: string;
  /** Building, unmortgaging: only on the Player's own turn. */
  canManage: boolean;
  /** Selling and mortgaging: also while paying a Debt. */
  canSell: boolean;
  canUseJailCard: boolean;
  onSelect: (index: number) => void;
  onProperty: (intent: PropertyIntent, index: number) => void;
  onUseJailCard: () => void;
};

/** The Player's hand along the bottom of the screen: a card per property, grouped by Colour group, then kept cards. */
export function Hand({ game, me, canManage, canSell, canUseJailCard, onSelect, onProperty, onUseJailCard }: Props) {
  const { groups, cards } = holdingsOf(game, me);
  const ref = useRef<HTMLElement>(null);

  // Publishes the bar's height so the page can make room for it (see `--hand-height` in styles.css).
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => root.setProperty('--hand-height', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.removeProperty('--hand-height');
    };
  }, []);

  return (
    <section ref={ref} className="hand" aria-label="My hand">
      {groups.length === 0 && cards.length === 0 && <p className="muted">No properties or cards yet</p>}
      {groups.map(({ group, spaces, complete }) => (
        <ul key={group} className={complete ? 'group complete' : 'group'} aria-label={complete ? `${group} (whole Colour group)` : group}>
          {spaces.map((s) => {
            const buildings = game.deeds[s.index]?.buildings ?? 0;
            const mortgaged = !!game.deeds[s.index]?.mortgaged;
            return (
              <li key={s.index} className={mortgaged ? 'hand-card mortgaged' : 'hand-card'}>
                <button
                  type="button"
                  className="face"
                  style={{ ['--band' as string]: s.type === 'street' ? groupColor(s.group) : 'var(--space)' }}
                  onClick={() => onSelect(s.index)}
                  title="View title deed"
                >
                  <span className="band" />
                  <span className="name">{s.name}</span>
                  <span className="detail">
                    {mortgaged ? 'Mortgaged' : buildings > 0 ? describeBuildings(buildings) : s.type === 'street' ? 'No buildings' : ' '}
                  </span>
                </button>
                <span className="card-actions">
                  {s.type === 'street' && (complete || buildings > 0) && (
                    <>
                      <button
                        className="small"
                        disabled={!canManage || buildings === HOTEL}
                        onClick={() => onProperty('BUILD', s.index)}
                      >
                        Build ({s.houseCost})
                      </button>
                      <button
                        className="small secondary"
                        disabled={!canSell || buildings === 0}
                        onClick={() => onProperty('SELL_BUILDING', s.index)}
                      >
                        Sell
                      </button>
                    </>
                  )}
                  {mortgaged ? (
                    <button className="small secondary" disabled={!canManage} onClick={() => onProperty('UNMORTGAGE', s.index)}>
                      Unmortgage ({unmortgageCost(s, game.rules)})
                    </button>
                  ) : (
                    <button
                      className="small secondary"
                      disabled={!canSell || groupHasBuildings(game, s)}
                      onClick={() => onProperty('MORTGAGE', s.index)}
                    >
                      Mortgage ({mortgageValue(s, game.rules)})
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ))}
      {cards.length > 0 && (
        <ul className="group" aria-label="Kept cards">
          {cards.map((c) => (
            <li key={c.key} className={`hand-card kept ${c.deck ?? ''}`}>
              <div className="face">
                <span className="band">{c.deck ? DECK_LABELS[c.deck] : 'Kept card'}</span>
                <span className="name">{c.title}</span>
                <span className="detail">{c.text}</span>
              </div>
              <span className="card-actions">
                <button className="small" disabled={!canUseJailCard} onClick={onUseJailCard}>
                  Use
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
