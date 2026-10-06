import { useState } from 'react';
import type { GameState, Rules, SpaceDefinition, SpaceEdit, SpaceField } from '@landlord/engine';
import { send, updateBoard, updateRules } from './socket';
import { FREE_PARKING_MODES, RULE_FIELDS, SPACE_FIELD_LABELS, type RuleField } from './ruleLabels';

/** Which editable values each kind of space has. */
const SPACE_FIELDS: Partial<Record<SpaceDefinition['type'], SpaceField[]>> = {
  street: ['name', 'price', 'houseCost', 'rents'],
  station: ['name', 'price'],
  utility: ['name', 'price'],
  tax: ['name', 'taxAmount'],
};

const ALL_SPACE_FIELDS: SpaceField[] = ['name', 'price', 'houseCost', 'rents', 'taxAmount'];

const toText = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);

/** Reads a number; text that is not a number goes to the server as is, so it can explain the refusal. */
const toNumber = (text: string): number | string => (text.trim() !== '' && !Number.isNaN(Number(text)) ? Number(text) : text);
const toList = (text: string): (number | string)[] => text.split(',').map(toNumber);

/** The Host's side panel for the Rules and Board: edits are staged and applied together. No one else sees it. */
export function RulesPanel({ game, onClose }: { game: GameState; onClose: () => void }) {
  // Only the fields the Host has touched; everything else keeps following the live values.
  const [ruleDraft, setRuleDraft] = useState<Partial<Record<keyof Rules, string | boolean>>>({});
  const [spaceDraft, setSpaceDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const dirty = Object.keys(ruleDraft).length + Object.keys(spaceDraft).length > 0;

  const shown = (field: RuleField): string | boolean =>
    ruleDraft[field.key] ?? (field.kind === 'toggle' ? !!game.rules[field.key] : toText(game.rules[field.key]));
  const setRule = (key: keyof Rules, value: string | boolean) => setRuleDraft((d) => ({ ...d, [key]: value }));

  const spaceKey = (index: number, field: SpaceField) => `${index}:${field}`;
  const spaceShown = (space: SpaceDefinition, field: SpaceField) =>
    spaceDraft[spaceKey(space.index, field)] ?? toText(space[field]);

  function ruleChanges(): Partial<Rules> {
    const changes: Record<string, unknown> = {};
    for (const field of RULE_FIELDS) {
      const value = ruleDraft[field.key];
      if (value === undefined) continue;
      if (field.kind === 'toggle' || field.kind === 'mode') changes[field.key] = value;
      else if (field.kind === 'list') changes[field.key] = toList(String(value));
      else if (field.kind === 'unlimited') changes[field.key] = String(value).trim() === '' ? null : toNumber(String(value));
      else changes[field.key] = toNumber(String(value));
    }
    return changes as Partial<Rules>;
  }

  function spaceEdits(): SpaceEdit[] {
    const edits = new Map<number, Record<string, unknown>>();
    for (const [key, text] of Object.entries(spaceDraft)) {
      const [index, field] = key.split(':') as [string, SpaceField];
      const edit = edits.get(Number(index)) ?? { index: Number(index) };
      edit[field] = field === 'name' ? text : field === 'rents' ? toList(text) : toNumber(text);
      edits.set(Number(index), edit);
    }
    return [...edits.values()] as SpaceEdit[];
  }

  async function apply() {
    setError(null);
    if (Object.keys(ruleDraft).length > 0) {
      const problem = await updateRules(ruleChanges());
      if (problem) return setError(problem);
      setRuleDraft({});
    }
    if (Object.keys(spaceDraft).length > 0) {
      const problem = await updateBoard(spaceEdits());
      if (problem) return setError(problem);
      setSpaceDraft({});
    }
  }

  async function reset() {
    setError(await send('RESET_TO_DEFAULTS'));
    setRuleDraft({});
    setSpaceDraft({});
  }

  function discard() {
    setRuleDraft({});
    setSpaceDraft({});
  }

  return (
    <aside className="rules-panel" aria-label="Rules">
      <div className="rules-head">
        <h2>Rules</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {game.pendingEdit && <p className="notice">Your changes will apply when the current action finishes.</p>}

      <div className="rules-form">
        {RULE_FIELDS.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            {field.kind === 'toggle' ? (
              <input
                type="checkbox"
                checked={shown(field) as boolean}
                onChange={(e) => setRule(field.key, e.target.checked)}
              />
            ) : field.kind === 'mode' ? (
              <select value={shown(field) as string} onChange={(e) => setRule(field.key, e.target.value)}>
                {FREE_PARKING_MODES.map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            ) : (
              <input value={shown(field) as string} onChange={(e) => setRule(field.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      <h3>Board</h3>
      <table className="board-form">
        <tbody>
          {game.board.map((space) => {
            const fields = SPACE_FIELDS[space.type] ?? ['name'];
            return (
              <tr key={space.index}>
                <td className="muted">{space.index}</td>
                {ALL_SPACE_FIELDS.map((field) => (
                  <td key={field}>
                    {fields.includes(field) && (
                      <input
                        aria-label={`${space.name} ${SPACE_FIELD_LABELS[field]}`}
                        placeholder={SPACE_FIELD_LABELS[field]}
                        value={spaceShown(space, field)}
                        onChange={(e) => setSpaceDraft((d) => ({ ...d, [spaceKey(space.index, field)]: e.target.value }))}
                      />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="actions">
        <button disabled={!dirty} onClick={apply}>
          Apply
        </button>
        <button className="secondary" disabled={!dirty} onClick={discard}>
          Discard
        </button>
        <button className="secondary" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </aside>
  );
}
