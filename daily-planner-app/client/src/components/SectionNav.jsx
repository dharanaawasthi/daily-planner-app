// Main navigation between the app's sections. One <nav>: a bottom tab bar on
// phones and a slim left sidebar on desktop (the switch is CSS only).
// To add a section (e.g. Dump, Fun), add one entry to SECTIONS and render its view.
import { useCallback, useEffect, useState } from 'react';
import { PersonIcon, SunIcon } from './icons.jsx';

export const SECTIONS = [
  { id: 'now', label: 'Now', Icon: SunIcon },
  { id: 'me', label: 'Me', Icon: PersonIcon },
];

const DEFAULT_SECTION = SECTIONS[0].id;

function sectionFromHash() {
  const id = window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id) ? id : null;
}

/**
 * The active section, kept in the URL hash (#now / #me) so a refresh opens the
 * same section. Switching uses replaceState: no extra history entries.
 * Unknown hashes (e.g. the skip link's #main) leave the section unchanged.
 */
export function useHashSection() {
  const [section, setSection] = useState(() => sectionFromHash() ?? DEFAULT_SECTION);

  useEffect(() => {
    const onHashChange = () => {
      const id = sectionFromHash();
      if (id) setSection(id);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = useCallback((id) => {
    window.history.replaceState(window.history.state, '', `#${id}`);
    setSection(id);
  }, []);

  return [section, select];
}

export default function SectionNav({ active, onSelect }) {
  return (
    <nav className="section-nav" aria-label="Main">
      <ul>
        {SECTIONS.map(({ id, label, Icon }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="section-nav-item"
              aria-current={active === id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onSelect(id);
              }}
            >
              <Icon width={22} height={22} />
              <span>{label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
