import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// If any screen throws while rendering, show this instead of a blank white page.
// Plain HTML and inline styles on purpose: this must still work when the UI library is what failed.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px', background: '#eef2f7', fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#0f2240' }}>
        <div style={{ maxWidth: '420px', textAlign: 'center', background: '#fff', padding: '32px 24px', borderRadius: '12px', border: '1px solid #dde3ec' }}>
          <h1 style={{ fontSize: '20px', margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#6b7fa0', lineHeight: 1.5 }}>
            This page hit an unexpected problem. Your appointments and data are safe. Reload the page to try again.
          </p>
          <button onClick={() => window.location.reload()} style={{ minHeight: '44px', padding: '0 20px', border: 'none', borderRadius: '8px', background: '#2563eb', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
            Reload page
          </button>
          <div style={{ marginTop: '12px' }}>
            <a href="/" style={{ fontSize: '13px', color: '#2563eb' }}>Back to sign in</a>
          </div>
        </div>
      </div>
    );
  }
}
