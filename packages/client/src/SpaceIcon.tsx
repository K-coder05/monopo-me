import type { ReactNode } from 'react';
import type { SpaceDefinition } from '@landlord/engine';

// Original flat icons, drawn on a 24×24 grid in the current text colour.
const PATHS: Partial<Record<SpaceDefinition['type'], ReactNode>> = {
  go: <path d="M3 10h11V5l8 7-8 7v-5H3z" />,
  station: (
    <>
      <rect x="5" y="2" width="14" height="15" rx="3" />
      <rect x="7.5" y="5" width="9" height="5" rx="1" fill="var(--space)" />
      <circle cx="8.5" cy="13.5" r="1.4" fill="var(--space)" />
      <circle cx="15.5" cy="13.5" r="1.4" fill="var(--space)" />
      <path d="M7 18h2.5l-2 4H5zm7.5 0H17l2 4h-2.5z" />
    </>
  ),
  utility: (
    <>
      <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
      <rect x="8.5" y="18" width="7" height="2" rx="1" />
      <rect x="10" y="21" width="4" height="1.5" rx=".75" />
    </>
  ),
  chance: (
    <>
      <rect x="3" y="2" width="18" height="20" rx="3" />
      <path
        d="M9.2 9a2.8 2.8 0 1 1 4 2.5c-.8.4-1.2 1-1.2 1.8V14"
        fill="none"
        stroke="var(--space)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.5" r="1.3" fill="var(--space)" />
    </>
  ),
  treasure: (
    <>
      <path d="M3 9a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1H3z" />
      <rect x="3" y="11" width="18" height="9" rx="1.5" />
      <rect x="10" y="9" width="4" height="5" rx="1" fill="var(--space)" />
    </>
  ),
  tax: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v12M15 8.5h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9" fill="none" stroke="var(--space)" strokeWidth="2" />
    </>
  ),
  jail: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 3v18M12 3v18M16 3v18" stroke="currentColor" strokeWidth="2" />
    </>
  ),
  freeParking: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M9.5 18V7h3.5a3 3 0 0 1 0 6H9.5" fill="none" stroke="var(--space)" strokeWidth="2.4" />
    </>
  ),
  goToJail: (
    <>
      <rect x="13" y="4" width="9" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 4v16M19 4v16" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2 10h6V6l5 6-5 6v-4H2z" />
    </>
  ),
};

/** The flat icon for a kind of space, or nothing for streets. */
export function SpaceIcon({ type, className }: { type: SpaceDefinition['type']; className?: string }) {
  const paths = PATHS[type];
  if (!paths) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {paths}
    </svg>
  );
}
