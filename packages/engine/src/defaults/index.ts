import type { Rules, SpaceDefinition } from '../types';
import rulesJson from './rules.default.json';
import boardJson from './board.default.json';

export const defaultRules: Rules = rulesJson as Rules;
export const defaultBoard: SpaceDefinition[] = boardJson as SpaceDefinition[];
