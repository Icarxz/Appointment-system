import { useImportSession } from './ImportSessionContextCore';
import SchedulePdfImporter from '../components/SchedulePdfImporter';
import BulkSchedulePdfImporter from '../components/BulkSchedulePdfImporter';
import ImportSessionMinimizedBar from './ImportSessionMinimizedBar';

export default function ImportSessionHost() {
  const { state } = useImportSession();
  if (!state.active) return null;
  if (state.kind === 'bulk') {
    return (
      <>
        <ImportSessionMinimizedBar />
        <BulkSchedulePdfImporter />
        {state.reviewId && (
          <SchedulePdfImporter
            key={state.reviewId}
            facultyId={state.facultyId}
            facultyName={state.facultyName}
            mode={state.mode}
            isOpen={!state.minimized}
          />
        )}
      </>
    );
  }
  return (
    <>
      <ImportSessionMinimizedBar />
      <SchedulePdfImporter
        facultyId={state.facultyId}
        facultyName={state.facultyName}
        mode={state.mode}
        isOpen={!state.minimized}
      />
    </>
  );
}
