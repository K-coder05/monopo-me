import { useState } from 'react';
import { HELD_CHOICE_NEEDED, missingPlayers, type Card, type CardDraft, type DeckKind, type Effect, type GameState, type HeldCardChoice, type PartySelector } from '@landlord/engine';
import { addCard, deleteCard, editCard, hideDeckContents, resetDeck, shuffleDeck } from './socket';
import {
  blankCard,
  DECK_LABELS,
  EFFECT_LABELS,
  missingLabel,
  newEffect,
  previewText,
  SELECTOR_LABELS,
  selectorFromKey,
  selectorKey,
  SHORTCUTS,
  shortcutOf,
  summarizeEffect,
  type Shortcut,
} from './cardLabels';

const DECKS: DeckKind[] = ['chance', 'treasure'];
const MAX_TITLE = 40;

/** The server's refusal when an edit touches a held card and needs the Host's choice. */
const needsHeldChoice = (error: string | null) => error === HELD_CHOICE_NEEDED;

/** Reads a number; text that is not a number goes to the server as is, so it can explain the refusal. */
const toAmount = (text: string): number | string => (text.trim() !== '' && !Number.isNaN(Number(text)) ? Number(text) : text);

const draftOf = (card: Card): CardDraft => ({
  title: card.title,
  text: card.text,
  effects: card.effects,
  enabled: card.enabled,
  copies: card.copies,
});

/** Side panel with one tab per Deck. The Host edits cards; everyone else browses unless contents are hidden. */
export function CardsPanel({ game, me, onClose }: { game: GameState; me: string; onClose: () => void }) {
  const isHost = me === game.hostId;
  const [tab, setTab] = useState<DeckKind>('chance');
  // The card being edited: an existing card's id, or null for a new one.
  const [form, setForm] = useState<{ cardId: string | null; draft: CardDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An edit waiting for the Host to say what happens to held copies.
  const [heldPrompt, setHeldPrompt] = useState<{ title: string; retry: (held: HeldCardChoice) => Promise<string | null> } | null>(null);
  const cards = game.decks[tab].cards;

  /** Sends an edit; if a Player holds the card, asks the Host first and sends it again with the answer. */
  async function run(title: string, send: (held?: HeldCardChoice) => Promise<string | null>): Promise<boolean> {
    setError(null);
    const problem = await send();
    if (needsHeldChoice(problem)) {
      setHeldPrompt({ title, retry: send });
      return false;
    }
    setError(problem);
    return problem === null;
  }

  async function answerHeld(held: HeldCardChoice) {
    const prompt = heldPrompt!;
    setHeldPrompt(null);
    const problem = await prompt.retry(held);
    setError(problem);
    if (problem === null) setForm(null);
  }

  async function save() {
    if (!form) return;
    const { cardId, draft } = form;
    const done = cardId === null ? await run(draft.title, () => addCard(tab, draft)) : await run(draft.title, (held) => editCard(cardId, draft, held));
    if (done) setForm(null);
  }

  const duplicate = (card: Card) =>
    run(card.title, () => addCard(tab, { ...draftOf(card), title: `${card.title} (copy)`.slice(0, MAX_TITLE) }));
  const toggle = (card: Card) => run(card.title, (held) => editCard(card.id, { ...draftOf(card), enabled: !card.enabled }, held));
  const remove = (card: Card) => run(card.title, (held) => deleteCard(card.id, held));

  const hidden = !!game.decksHidden && !isHost;

  return (
    <aside className="rules-panel" aria-label="Cards">
      <div className="rules-head">
        <h2>Cards</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {isHost ? (
        <label className="hide-toggle">
          <input type="checkbox" checked={!!game.decksHidden} onChange={async (e) => setError(await hideDeckContents(e.target.checked))} /> Hide deck
          contents from other Players
        </label>
      ) : (
        <p className="muted">Only the Host can change the cards.</p>
      )}

      <div className="tabs" role="tablist">
        {DECKS.map((deck) => (
          <button
            key={deck}
            role="tab"
            aria-selected={tab === deck}
            className={tab === deck ? '' : 'secondary'}
            onClick={() => {
              setTab(deck);
              setForm(null);
            }}
          >
            {DECK_LABELS[deck]}
          </button>
        ))}
      </div>

      {hidden ? (
        <p className="notice">The Host has hidden the deck contents.</p>
      ) : (
        <>
          {isHost && !form && (
            <div className="actions">
              <button onClick={() => setForm({ cardId: null, draft: blankCard() })}>New card</button>
              <button className="secondary" onClick={async () => setError(await shuffleDeck(tab))}>
                Shuffle deck now
              </button>
              <button className="secondary" onClick={async () => setError(await resetDeck(tab))}>
                Reset deck to default
              </button>
            </div>
          )}

          {form && (
            <CardForm
              game={game}
              deck={tab}
              isNew={form.cardId === null}
              draft={form.draft}
              onChange={(draft) => setForm({ ...form, draft })}
              onSave={save}
              onCancel={() => setForm(null)}
            />
          )}

          {cards.length === 0 && <p className="muted">This deck is empty. Landing on it does nothing.</p>}
          <ul className="card-list">
            {cards.map((card) => (
              <li key={card.id} className={card.enabled ? '' : 'disabled'}>
                <div className="card-row-head">
                  <strong>{card.title}</strong>
                  <span className="muted">×{card.copies}</span>
                  <label>
                    <input type="checkbox" disabled={!isHost} checked={card.enabled} onChange={() => toggle(card)} /> on
                  </label>
                </div>
                <p>{card.text}</p>
                {card.enabled && missingPlayers(card).length > 0 && (
                  <p className="notice">
                    Names {[...new Set(missingPlayers(card))].join(' and ')}, not in this Room. It won&apos;t be drawn until the Host picks a
                    Player for it or turns it off.
                  </p>
                )}
                <ul className="muted effect-summary">
                  {card.effects.map((effect, i) => (
                    <li key={i}>{summarizeEffect(effect, game)}</li>
                  ))}
                </ul>
                {isHost && (
                  <div className="actions">
                    <button className="secondary" onClick={() => setForm({ cardId: card.id, draft: draftOf(card) })}>
                      Edit
                    </button>
                    <button className="secondary" onClick={() => duplicate(card)}>
                      Duplicate
                    </button>
                    <button className="secondary" onClick={() => remove(card)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}

      {heldPrompt && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-label="Held card">
            <h2>{heldPrompt.title}</h2>
            <p>A Player is holding this card. Let them keep it until they use it, or take it away now?</p>
            <div className="actions">
              <button onClick={() => answerHeld('keep')}>Let them keep it</button>
              <button onClick={() => answerHeld('remove')}>Remove it now</button>
              <button className="secondary" onClick={() => setHeldPrompt(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function CardForm({
  game,
  deck,
  isNew,
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  game: GameState;
  deck: DeckKind;
  isNew: boolean;
  draft: CardDraft;
  onChange: (draft: CardDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const setEffect = (i: number, effect: Effect) => onChange({ ...draft, effects: draft.effects.map((e, j) => (j === i ? effect : e)) });
  return (
    <div className="card-form">
      <h3>{isNew ? 'New card' : 'Edit card'}</h3>
      <label>
        <span>Title</span>
        <input maxLength={MAX_TITLE} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      </label>
      <label>
        <span>Text</span>
        <textarea
          rows={2}
          value={draft.text}
          placeholder="Use {amount}, {from} and {to}"
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
        />
      </label>
      <label>
        <span>Copies</span>
        <input type="number" min={1} max={10} value={draft.copies} onChange={(e) => onChange({ ...draft, copies: Number(e.target.value) })} />
      </label>

      <h4>Effects, in order</h4>
      {draft.effects.map((effect, i) => (
        <EffectRow
          key={i}
          game={game}
          effect={effect}
          onChange={(next) => setEffect(i, next)}
          onRemove={draft.effects.length > 1 ? () => onChange({ ...draft, effects: draft.effects.filter((_, j) => j !== i) }) : undefined}
        />
      ))}
      <button className="secondary" onClick={() => onChange({ ...draft, effects: [...draft.effects, newEffect('collect')] })}>
        Add another effect
      </button>

      <div className="modal card preview" aria-label="Preview">
        <p className="muted">{DECK_LABELS[deck]}</p>
        <h2>{draft.title || 'Untitled'}</h2>
        <p>{previewText(draft, game)}</p>
      </div>

      <div className="actions">
        <button onClick={onSave}>Save</button>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Effects that take a `target` Party. */
const TARGETED: Effect['type'][] = ['MOVE_TO', 'MOVE_RELATIVE', 'MOVE_TO_NEAREST', 'GO_TO_JAIL', 'REPAIRS', 'SKIP_TURNS', 'EXTRA_TURN', 'SWAP_POSITION'];

const SELECTOR_KEYS = Object.keys(SELECTOR_LABELS) as (keyof typeof SELECTOR_LABELS)[];

function PartySelect({
  game,
  label,
  value,
  allowBank = true,
  onChange,
}: {
  game: GameState;
  label: string;
  value: PartySelector | undefined;
  allowBank?: boolean;
  onChange: (s: PartySelector) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={selectorKey(value)} onChange={(e) => onChange(selectorFromKey(e.target.value))}>
        {SELECTOR_KEYS.filter((k) => allowBank || k !== 'bank').map((k) => (
          <option key={k} value={k}>
            {SELECTOR_LABELS[k]}
          </option>
        ))}
        {game.players.map((p) => (
          <option key={p.id} value={`player:${p.id}`}>
            {p.name}
          </option>
        ))}
        {typeof value === 'object' && 'playerName' in value && <option value={selectorKey(value)}>{missingLabel(value.playerName)}</option>}
      </select>
    </label>
  );
}

function EffectRow({
  game,
  effect,
  onChange,
  onRemove,
}: {
  game: GameState;
  effect: Effect;
  onChange: (effect: Effect) => void;
  onRemove?: () => void;
}) {
  const target = TARGETED.includes(effect.type) ? (
      <PartySelect
        game={game}
        label="Who"
        value={(effect as { target?: PartySelector }).target}
        allowBank={false}
        onChange={(t) => onChange({ ...effect, target: t } as Effect)}
      />
    ) : null;

  return (
    <fieldset className="effect-row">
      <label>
        <span>Effect</span>
        <select value={shortcutOf(effect) ?? effect.type} onChange={(e) => onChange(newEffect(e.target.value as Effect['type'] | Shortcut, effect))}>
          <optgroup label="Shortcuts">
            {(Object.keys(SHORTCUTS) as Shortcut[]).map((k) => (
              <option key={k} value={k}>
                {SHORTCUTS[k].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Effect types">
            {(Object.keys(EFFECT_LABELS) as Effect['type'][]).map((t) => (
              <option key={t} value={t}>
                {EFFECT_LABELS[t]}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      {effect.type === 'TRANSFER' && (
        <>
          <label>
            <span>Amount</span>
            <input
              value={String(effect.amount)}
              title="A number, dice, dice * 10 or percentOfCash(10)"
              onChange={(e) => onChange({ ...effect, amount: toAmount(e.target.value) })}
            />
          </label>
          <PartySelect game={game} label="Who pays" value={effect.from} onChange={(from) => onChange({ ...effect, from })} />
          <PartySelect game={game} label="Who receives" value={effect.to} onChange={(to) => onChange({ ...effect, to })} />
        </>
      )}
      {effect.type === 'MOVE_TO' && (
        <>
          <label>
            <span>Space</span>
            <select value={effect.index} onChange={(e) => onChange({ ...effect, index: Number(e.target.value) })}>
              {game.board.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.index}: {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Collect salary passing GO</span>
            <input type="checkbox" checked={effect.collectGo} onChange={(e) => onChange({ ...effect, collectGo: e.target.checked })} />
          </label>
        </>
      )}
      {effect.type === 'MOVE_RELATIVE' && (
        <label>
          <span>Steps (negative = back)</span>
          <input type="number" value={effect.steps} onChange={(e) => onChange({ ...effect, steps: Number(e.target.value) })} />
        </label>
      )}
      {effect.type === 'MOVE_TO_NEAREST' && (
        <>
          <label>
            <span>Nearest</span>
            <select value={effect.kind} onChange={(e) => onChange({ ...effect, kind: e.target.value as 'station' | 'utility' })}>
              <option value="station">station</option>
              <option value="utility">utility</option>
            </select>
          </label>
          <label>
            <span>If owned, pay</span>
            <select
              value={effect.diceMultiplier !== undefined ? 'dice' : effect.rentMultiplier !== undefined ? 'rent' : 'normal'}
              onChange={(e) => {
                const { rentMultiplier: _r, diceMultiplier: _d, ...rest } = effect;
                const mode = e.target.value;
                onChange(mode === 'rent' ? { ...rest, rentMultiplier: 2 } : mode === 'dice' ? { ...rest, diceMultiplier: 10 } : rest);
              }}
            >
              <option value="normal">normal rent</option>
              <option value="rent">a multiple of rent</option>
              <option value="dice">a multiple of the dice</option>
            </select>
          </label>
          {effect.rentMultiplier !== undefined && (
            <label>
              <span>Rent ×</span>
              <input type="number" value={effect.rentMultiplier} onChange={(e) => onChange({ ...effect, rentMultiplier: Number(e.target.value) })} />
            </label>
          )}
          {effect.diceMultiplier !== undefined && (
            <label>
              <span>Dice ×</span>
              <input type="number" value={effect.diceMultiplier} onChange={(e) => onChange({ ...effect, diceMultiplier: Number(e.target.value) })} />
            </label>
          )}
        </>
      )}
      {effect.type === 'REPAIRS' && (
        <>
          <label>
            <span>Per house</span>
            <input type="number" value={effect.perHouse} onChange={(e) => onChange({ ...effect, perHouse: Number(e.target.value) })} />
          </label>
          <label>
            <span>Per hotel</span>
            <input type="number" value={effect.perHotel} onChange={(e) => onChange({ ...effect, perHotel: Number(e.target.value) })} />
          </label>
        </>
      )}
      {effect.type === 'SKIP_TURNS' && (
        <label>
          <span>Turns</span>
          <input type="number" min={1} max={10} value={effect.count} onChange={(e) => onChange({ ...effect, count: Number(e.target.value) })} />
        </label>
      )}
      {target}
      {onRemove && (
        <button className="secondary" onClick={onRemove}>
          Remove effect
        </button>
      )}
    </fieldset>
  );
}
