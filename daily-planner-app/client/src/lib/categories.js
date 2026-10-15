// Single source of truth for category names and colors on the client.
// Names must match the server's CATEGORIES list exactly.
export const CATEGORIES = {
  Study: { color: '#2563eb', tint: '#eff4ff', label: 'Study' }, // blue
  Gym: { color: '#16a34a', tint: '#ecfdf3', label: 'Gym' }, // green
  Career: { color: '#7c3aed', tint: '#f4f0ff', label: 'Career' }, // purple
  Personal: { color: '#ea580c', tint: '#fff4ec', label: 'Personal' }, // orange
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

export function categoryStyle(name) {
  return CATEGORIES[name] ?? { color: '#64748b', tint: '#f1f5f9', label: name };
}
