import { useImportSession } from './ImportSessionContextCore';
import SchedulePdfImporter from '../components/SchedulePdfImporter';

export default function ImportSessionHost() {
  const { state, actions } = useImportSession();
  if (!state.active || state.kind !== 'single') return null;
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
