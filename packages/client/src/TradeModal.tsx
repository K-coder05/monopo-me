import { useState } from 'react';
import { groupHasBuildings, type GameState, type TradeSide } from '@landlord/engine';
import { proposeTrade, send } from './socket';

const empty = (): TradeSide => ({ cash: 0, properties: [], cards: [] });

/** Who `me` may send an offer to right now; the engine has the final say. */
export function tradePartners(game: GameState, me: string): string[] {
  const turn = game.turn;
  const active = turn?.playerId;
  const owesDebt = turn?.step === 'awaitDebt' && game.debts[0]?.debtorId === me;
  const others = game.players.filter((p) => p.id !== me && !p.bankrupt).map((p) => p.id);
  return active === me || owesDebt ? others : others.filter((id) => id === active);
}

/** One side of the builder: cash, properties and jail cards `ownerId` hands over. */
function SideEditor({
  game,
  ownerId,
  value,
  onChange,
}: {
  game: GameState;
  ownerId: string;
  value: TradeSide;
  onChange: (side: TradeSide) => void;
}) {
  const owner = game.players.find((p) => p.id === ownerId)!;
  const properties = game.board.filter((s) => game.deeds[s.index]?.ownerId === ownerId);
  const toggle = (index: number) =>
    onChange({
      ...value,
      properties: value.properties.includes(index) ? value.properties.filter((i) => i !== index) : [...value.properties, index],
    });
  return (
    <fieldset className="trade-side">
      <legend>{owner.name} gives</legend>
      <label>
        Cash (of {owner.cash}){' '}
        <input
          type="number"
          min={0}
          value={value.cash}
          onChange={(e) => onChange({ ...value, cash: Math.floor(Number(e.target.value) || 0) })}
        />
      </label>
      {properties.map((s) => {
        const locked = groupHasBuildings(game, s);
        return (
          <label key={s.index} className={locked ? 'muted' : ''}>
            <input type="checkbox" disabled={locked} checked={value.properties.includes(s.index)} onChange={() => toggle(s.index)} />{' '}
            {s.name}
            {game.deeds[s.index]?.mortgaged && ' (mortgaged)'}
            {locked && ' (has buildings in group)'}
          </label>
        );
      })}
      {owner.heldCards.length > 0 && (
        <label>
          Jail cards (of {owner.heldCards.length}){' '}
          <input
            type="number"
            min={0}
            max={owner.heldCards.length}
            value={value.cards.length}
            onChange={(e) => onChange({ ...value, cards: owner.heldCards.slice(0, Math.max(0, Number(e.target.value) || 0)) })}
          />
        </label>
      )}
    </fieldset>
  );
}

function Summary({ game, side }: { game: GameState; side: TradeSide }) {
  const items = [
    ...(side.cash > 0 ? [`${side.cash} cash`] : []),
    ...side.properties.map((i) => game.board[i]?.name ?? `space ${i}`),
    ...side.cards.map(() => 'jail card'),
  ];
  return <>{items.length > 0 ? items.join(', ') : 'nothing'}</>;
}

/**
 * The trade builder (while `building`) or the open offer. Everyone sees the offer; only its two
 * Players get controls.
 */
export function TradeModal({
  game,
  me,
  building,
  onBuild,
  onClose,
}: {
  game: GameState;
  me: string;
  building: boolean;
  onBuild: () => void;
  onClose: () => void;
}) {
  const open = game.trade;
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const partners = open ? [open.partnerId === me ? open.proposerId : open.partnerId] : tradePartners(game, me);
  // A counter starts from the offer with its sides swapped; a revision from the offer as sent.
  const seed = open ? (open.partnerId === me ? { give: open.take, take: open.give } : { give: open.give, take: open.take }) : null;
  const [partnerId, setPartnerId] = useState(partners[0] ?? '');
  const [give, setGive] = useState<TradeSide>(seed?.give ?? empty());
  const [take, setTake] = useState<TradeSide>(seed?.take ?? empty());
  const [error, setError] = useState<string | null>(null);

  async function run(action: Promise<string | null>, closeAfter = true) {
    const result = await action;
    setError(result);
    if (result === null && closeAfter) onClose();
  }

  if (building) {
    return (
      <div className="backdrop">
        <div className="modal trade" role="dialog" aria-label="Trade builder">
          <h2>{open ? (open.partnerId === me ? 'Counter-offer' : 'Revise offer') : 'New trade'}</h2>
          <label>
            Trade with{' '}
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} disabled={!!open}>
              {partners.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
          <SideEditor game={game} ownerId={me} value={give} onChange={setGive} />
          {partnerId && <SideEditor game={game} ownerId={partnerId} value={take} onChange={setTake} />}
          <div className="actions">
            <button disabled={!partnerId} onClick={() => run(proposeTrade(partnerId, give, take))}>
              Send offer
            </button>
            <button className="secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  if (!open) return null;
  const isPartner = open.partnerId === me;
  const isProposer = open.proposerId === me;
  return (
    <div className="backdrop">
      <div className="modal trade" role="dialog" aria-label="Trade offer">
        <h2>
          {name(open.proposerId)} offers {name(open.partnerId)} a trade
        </h2>
        <p>
          {name(open.proposerId)} gives: <Summary game={game} side={open.give} />
        </p>
        <p>
          {name(open.partnerId)} gives: <Summary game={game} side={open.take} />
        </p>
        {isPartner && (
          <div className="actions">
            <button onClick={() => run(send('ACCEPT_TRADE'), false)}>Accept</button>
            <button className="secondary" onClick={() => run(send('REJECT_TRADE'), false)}>
              Reject
            </button>
            <button className="secondary" onClick={onBuild}>
              Counter
            </button>
          </div>
        )}
        {isProposer && (
          <div className="actions">
            <button className="secondary" onClick={onBuild}>
              Revise
            </button>
            <button className="secondary" onClick={() => run(send('WITHDRAW_TRADE'), false)}>
              Withdraw
            </button>
          </div>
        )}
        {!isPartner && !isProposer && <p className="muted">Waiting for {name(open.partnerId)} to answer.</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
