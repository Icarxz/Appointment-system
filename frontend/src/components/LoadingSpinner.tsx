// The app's loading indicator: a pure-CSS spinner (styles/feedback.css) plus a label for screen readers.
//   layout="inline"  next to text or inside a button row (default)
//   layout="block"   centred inside a card or panel that is waiting for data
//   layout="page"    centred in the middle of a whole page
// It stays invisible for the first 150 ms, so quick loads never flash a spinner.
interface Props {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  layout?: 'inline' | 'block' | 'page';
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
}

export default function LoadingSpinner({ label = 'Loading', size = 'md', layout = 'inline', hideLabel = false }: Props) {
  return (
    <div className={`sync-loading sync-loading--${layout}`} role="status" aria-live="polite">
      <span className={`sync-spinner sync-spinner--${size}`} aria-hidden="true" />
      {hideLabel ? <span className="sync-sr-only">{label}</span> : <span>{label}…</span>}
    </div>
  );
}
