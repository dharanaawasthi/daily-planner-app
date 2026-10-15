import { useCallback, useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../lib/planningSettings.js';

const BLOCKED_STORAGE = {
  getItem: () => null,
  setItem: () => {
    throw new Error('Storage unavailable');
  },
};

/** localStorage, or null where the browser blocks it (some private modes). */
function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Planning settings for this device. `save` validates and persists; it
 * returns the same result object as saveSettings().
 */
export function usePlanningSettings(today) {
  const [settings, setSettings] = useState(() => loadSettings(getStorage(), today));

  // When the day rolls over, a planning date that is now in the past moves to today.
  useEffect(() => {
    setSettings((current) => (current.planningDate < today ? { ...current, planningDate: today } : current));
  }, [today]);

  const save = useCallback(
    (next) => {
      // With storage blocked, saveSettings still validates, then reports storageError.
      const storage = getStorage() ?? BLOCKED_STORAGE;
      const result = saveSettings(storage, next, today);
      // Even if the browser won't store it, use the settings for this session.
      if (result.ok || result.storageError) setSettings(next);
      return result;
    },
    [today],
  );

  return { settings, save };
}
