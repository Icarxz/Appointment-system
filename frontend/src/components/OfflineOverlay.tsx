import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useOnlineStatus } from '../utils/useOnlineStatus';

// The full-screen "you're offline" page. It sits ON TOP of the app instead of replacing it, so whatever someone was
// typing stays in its form and is still there when the connection returns. Plain HTML and CSS classes on purpose
// (styles/feedback.css), so it still works when the UI library is what failed.
function OfflineArt() {
  return (
    <svg className="sync-offline__art" width="168" height="128" viewBox="0 0 168 128" aria-hidden="true" focusable="false">
      <ellipse className="art-shadow" cx="84" cy="116" rx="48" ry="6" />
      <g className="art-cloud">
        <circle cx="62" cy="76" r="22" />
        <circle cx="92" cy="62" r="30" />
        <circle cx="120" cy="80" r="19" />
        <rect x="60" y="78" width="60" height="21" rx="10.5" />
      </g>
      <line className="art-cut" x1="38" y1="24" x2="130" y2="108" strokeWidth="16" strokeLinecap="round" />
      <line className="art-slash" x1="38" y1="24" x2="130" y2="108" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export default function OfflineOverlay() {
  const { online, checking, justBack, recheck } = useOnlineStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // While the page is showing: keep the page behind it from scrolling, move focus to the button, and put focus back after.
  useEffect(() => {
    if (online) return;
    const before = document.activeElement as HTMLElement | null;
    const scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    buttonRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = scroll;
      before?.focus?.();
    };
  }, [online]);

  if (online) {
    return justBack ? <div className="sync-toast" role="status">Back online</div> : null;
  }

  return (
    <div
      className="sync-offline" role="alertdialog" aria-modal="true"
      aria-labelledby="sync-offline-title" aria-describedby="sync-offline-desc"
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Tab') { e.preventDefault(); buttonRef.current?.focus(); } }} // the button is the only control
    >
      <div className="sync-offline__card">
        <OfflineArt />
        <h1 id="sync-offline-title">You’re offline</h1>
        <p id="sync-offline-desc">CCIS Sync needs an internet connection. Check your Wi-Fi or mobile data. We’ll reconnect on our own.</p>
        <p className="sync-offline__note">Anything you were typing is still here and will be waiting when you’re back.</p>
        <button ref={buttonRef} type="button" className="sync-btn" aria-disabled={checking} onClick={() => { if (!checking) void recheck(); }}>
          {checking ? (<><span className="sync-spinner sync-spinner--sm sync-spinner--on-accent" aria-hidden="true" />Checking…</>) : 'Try again'}
        </button>
        <p className="sync-offline__status" role="status" aria-live="polite">
          {checking ? 'Checking your connection…' : 'Still offline. Checking again every few seconds.'}
        </p>
      </div>
    </div>
  );
}
