import type { Card, DeckKind, Rules, SpaceDefinition } from '../types';
import rulesJson from './rules.default.json';
import boardJson from './board.default.json';
import decksJson from './decks.default.json';

export const defaultRules: Rules = rulesJson as Rules;
export const defaultBoard: SpaceDefinition[] = boardJson as SpaceDefinition[];
export const defaultCards: Record<DeckKind, Card[]> = decksJson as Record<DeckKind, Card[]>;
