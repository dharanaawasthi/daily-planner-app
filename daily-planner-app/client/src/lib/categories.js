// Single source of truth for category names on the client.
// Names must match the server's CATEGORIES list exactly.
// Colours are CSS tokens (light + dark values live in styles.css).
export const CATEGORIES = {
  Study: { color: 'var(--study)', tint: 'var(--study-tint)', label: 'Study' }, // blue
  Gym: { color: 'var(--gym)', tint: 'var(--gym-tint)', label: 'Gym' }, // green
  Career: { color: 'var(--career)', tint: 'var(--career-tint)', label: 'Career' }, // purple
  Personal: { color: 'var(--personal)', tint: 'var(--personal-tint)', label: 'Personal' }, // orange
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

export function categoryStyle(name) {
  return CATEGORIES[name] ?? { color: 'var(--muted)', tint: 'var(--surface-muted)', label: name };
}
