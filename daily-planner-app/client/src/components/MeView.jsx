import { UserButton } from '@clerk/react';
import { formatShortDate, formatTime } from '../lib/dates.js';
import { GearIcon } from './icons.jsx';

/** Me: planning settings, account, and a note about the theme. */
export default function MeView({ settings, today, onOpenSettings, headingRef }) {
  return (
    <div className="me-view">
      <h2 ref={headingRef} tabIndex={-1} className="section-title">
        Me
      </h2>

      <section className="card me-card" aria-labelledby="me-planning-heading">
        <h3 id="me-planning-heading" className="me-card-title">
          Planning
        </h3>
        <button type="button" className="btn btn-ghost" onClick={onOpenSettings}>
          <GearIcon width={17} height={17} />
          Planning settings
        </button>
        <p className="planning-summary">
          Planning {settings.planningDate === today ? 'today' : formatShortDate(settings.planningDate)}
          {' · '}
          {formatTime(settings.dayStart)} – {formatTime(settings.dayEnd)}
          {settings.preferDeepWorkBeforeNoon && ' · Deep focus before noon'}
        </p>
      </section>

      <section className="card me-card" aria-labelledby="me-account-heading">
        <h3 id="me-account-heading" className="me-card-title">
          Account
        </h3>
        {/* Clerk's account menu: profile, manage account, sign out */}
        <span className="user-button">
          <UserButton />
        </span>
      </section>

      <p className="me-note">Theme follows your device (light/dark).</p>
    </div>
  );
}
