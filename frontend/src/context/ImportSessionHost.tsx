import { useImportSession } from './ImportSessionContextCore';
import SchedulePdfImporter from '../components/SchedulePdfImporter';
import BulkSchedulePdfImporter from '../components/BulkSchedulePdfImporter';

export default function ImportSessionHost() {
  const { state, actions } = useImportSession();
  if (!state.active) return null;
  if (state.kind === 'bulk') {
    return (
      <>
        <BulkSchedulePdfImporter />
        {state.reviewId && (
          <SchedulePdfImporter
            key={state.reviewId}
            facultyId={state.facultyId}
            facultyName={state.facultyName}
            mode={state.mode}
            isOpen={!state.minimized}
            onClose={actions.minimize}
          />
        )}
      </>
    );
  }
  return (
    <SchedulePdfImporter
      facultyId={state.facultyId}
      facultyName={state.facultyName}
      mode={state.mode}
      isOpen={!state.minimized}
      onClose={actions.minimize}
    />
  );
}
