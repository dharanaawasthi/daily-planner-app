import { categoryStyle } from '../lib/categories.js';

/**
 * Category colors live ONLY here (the dot) and in the form's category picker.
 * The label is dark text, so the category reads clearly without relying on color.
 */
export default function CategoryChip({ category }) {
  const cat = categoryStyle(category);
  return (
    <span className="chip" style={{ '--cat': cat.color }}>
      <span className="chip-dot" aria-hidden="true" />
      {cat.label}
    </span>
  );
}
