export const GROUP_COLORS: Record<string, string> = {
  brown: '#8b5a2b',
  lightBlue: '#a8d8f0',
  pink: '#d63a96',
  orange: '#f39c12',
  red: '#e02020',
  yellow: '#f5e050',
  green: '#1fa84f',
  darkBlue: '#1f4fa8',
};

export function groupColor(group: string | undefined): string {
  return GROUP_COLORS[group ?? ''] ?? '#999';
}
