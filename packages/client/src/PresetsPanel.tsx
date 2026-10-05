import { useEffect, useState } from 'react';
import { MAX_PRESET_NAME, type GameState, type Preset } from '@landlord/engine';
import { exportPreset, importPreset, listPresets, loadPreset, savePreset } from './socket';

/** A file name made from the Preset name, safe on any system. */
const fileName = (name: string) => `${name.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') || 'preset'}.preset.json`;

function download(preset: Preset) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(preset.name);
  link.click();
  URL.revokeObjectURL(url);
}

/** Host-only side panel: save the Room's Rules, Board and Decks as a Preset, load one, and move Presets in and out as files. */
export function PresetsPanel({ game, onClose }: { game: GameState; onClose: () => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  // The Preset waiting for the Host to confirm loading it.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const result = await listPresets();
    if ('error' in result) setError(result.error);
    else setNames(result.names);
  }

  useEffect(() => {
    void refresh();
  }, []);

  function report(problem: string | null, success: string) {
    setError(problem);
    setNotice(problem ? null : success);
  }

  async function save() {
    const problem = await savePreset(name);
    report(problem, `Saved "${name.trim()}"`);
    if (!problem) {
      setName('');
      await refresh();
    }
  }

  async function load(preset: string) {
    setConfirming(null);
    report(await loadPreset(preset), `Loaded "${preset}"`);
  }

  async function exportOne(preset: string) {
    const result = await exportPreset(preset);
    if ('error' in result) return setError(result.error);
    download(result.preset);
  }

  async function importFile(file: File) {
    let parsed: Preset;
    try {
      parsed = JSON.parse(await file.text()) as Preset;
    } catch {
      return report('That file is not a Preset (it is not valid JSON)', '');
    }
    const result = await importPreset(parsed);
    if ('error' in result) return report(result.error, '');
    report(null, `Imported "${result.name}"`);
    await refresh();
  }

  const replaces = names.find((n) => n.toLowerCase() === name.trim().toLowerCase());

  return (
    <aside className="rules-panel" aria-label="Presets">
      <div className="rules-head">
        <h2>Presets</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted">A Preset holds the Rules, Board and both Decks, never cash, properties or positions.</p>

      <h3>Save the current setup</h3>
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input maxLength={MAX_PRESET_NAME} placeholder="Preset name" aria-label="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={name.trim() === ''}>Save</button>
      </form>
      {replaces && <p className="muted">This replaces the saved Preset "{replaces}".</p>}

      <h3>Saved Presets</h3>
      {names.length === 0 && <p className="muted">No Presets saved yet.</p>}
      <ul className="card-list">
        {names.map((preset) => (
          <li key={preset}>
            <div className="card-row-head">
              <strong>{preset}</strong>
            </div>
            {confirming === preset ? (
              <>
                <p>
                  Replace the Rules, Board and both Decks with "{preset}"?
                  {game.phase === 'playing' && ' Rules and Board changes wait for any running Auction, Debt or Card.'}
                </p>
                <div className="actions">
                  <button onClick={() => load(preset)}>Load</button>
                  <button className="secondary" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="actions">
                <button className="secondary" onClick={() => setConfirming(preset)}>
                  Load…
                </button>
                <button className="secondary" onClick={() => exportOne(preset)}>
                  Export
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <h3>Import</h3>
      <label>
        <span className="muted">A Preset file exported from this game; one with the same name is replaced.</span>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </label>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </aside>
  );
}
