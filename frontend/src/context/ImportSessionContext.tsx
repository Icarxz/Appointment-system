"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from '@chakra-ui/react';
import { authFetch } from '../components/authFetch';
import { matchFacultyByFilename, type FacultyLite, type FileMatch } from '../utils/facultyMatch';
import { ImportSessionContext } from './ImportSessionContextCore';

const API = import.meta.env.VITE_API_URL;

// One import session at a time per user. The provider wraps <Routes> in App.tsx so it stays mounted
// when the user changes nav pages or minimizes an import window. Work survives navigation; only a
// browser refresh / logout may lose it (beforeunload warns while there is unsaved work).

export interface ImportRow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  needsReview: boolean;
  reviewReasons: string[];
  rawText?: string;
  subject?: string;
  section?: string;
  room?: string;
  label?: string;
}

export interface ImportIssue {
  code: string;
  message: string;
  ref: { type: 'class' | 'consult'; id: string } | null;
}

export interface ImportReport {
  scheduleFingerprint?: string;
  ok: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  summary: { weeklyConsultationMinutes: number };
  identity?: { status: 'match' | 'mismatch' | 'unreadable'; read: string };
}

export interface ImportParsed {
  metadata: {
    term: string;
    academicYear: string;
    effectivityDate: string;
    facultyName: string;
    facultyNameConfidence: number | null;
    facultyNameNeedsReview: boolean;
  };
  workload: { lectureHours: number | null; laboratoryHours: number | null };
  classes: ImportRow[];
  consultationHours: ImportRow[];
  warnings: ImportIssue[];
  excludedWeekendConsultations: number;
}

export interface ImportOutcome {
  status: 'ACTIVE' | 'SCHEDULED';
  effectivityDate: string;
  counts?: { classes: number; hours: number };
}

export interface ImportSessionCallbacks {
  onApplied?: () => void;
  onDone?: (status: ImportOutcome['status']) => void;
  onCancel?: () => void;
}

export interface ImportSessionStartOptions {
  files?: File[];
  facultyList?: FacultyLite[];
  callbacks?: ImportSessionCallbacks;
}

export interface ImportFile {
  id: string;
  file: File;
  match: FileMatch;
  facultyId: string;
  ocr: 'waiting' | 'queued' | 'reading' | 'done' | 'failed';
  error: string;
  data: ImportParsed | null;
  fileHash: string;
  identity: 'unchecked' | 'checking' | 'match' | 'mismatch' | 'unreadable';
  identityRead: string;
  alreadyImported: string;
  importState: 'pending' | 'imported' | 'scheduled';
  reviewDraft?: {
    parsed: ImportParsed;
    classes: ImportRow[];
    hours: ImportRow[];
    identity: boolean;
    effDate: string;
  };
}

export interface ImportSessionState {
  active: boolean;
  kind: 'single' | 'bulk';
  mode: 'admin' | 'faculty';
  facultyId: string;
  facultyName: string;
  facultyList: FacultyLite[];
  minimized: boolean;
  pendingOpen: boolean;
  parsed: ImportParsed | null;
  classes: ImportRow[];
  hours: ImportRow[];
  report: ImportReport | null;
  busy: boolean;
  reading: boolean;
  nextId: number;
  outcome: ImportOutcome | null;
  fileHash: string;
  effDate: string;
  identity: boolean;
  uploadError: string;
  confirming: boolean;
  files: ImportFile[];
  problems: string[];
  skipped: number;
  reviewId: string | null;
}

interface ImportSessionActions {
  begin: (kind: 'single' | 'bulk', mode: 'admin' | 'faculty', facultyId: string, facultyName: string, options?: ImportSessionStartOptions) => boolean;
  minimize: () => void;
  restore: () => void;
  clear: () => void;
  uploadPdf: (file: File | undefined) => Promise<void>;
  loadFile: (file: File | undefined) => Promise<void>;
  check: () => Promise<void>;
  confirm: () => Promise<void>;
  editClass: (id: string, patch: Partial<ImportRow>) => void;
  editHour: (id: string, patch: Partial<ImportRow>) => void;
  addClass: () => void;
  addHour: () => void;
  removeRow: (type: 'class' | 'consult', id: string) => void;
  notifyApplied: () => void;
  setIdentity: (checked: boolean) => void;
  setEffDate: (date: string) => void;
  resetDraft: () => void;
  setReviewId: (id: string | null) => void;
  openReview: (id: string) => void;
  backToList: () => void;
  closeReview: () => void;
  addFiles: (files: File[]) => Promise<void>;
  assignFaculty: (id: string, facultyId: string) => void;
  retryFile: (id: string) => void;
  removeFile: (id: string) => void;
  resetBulk: () => void;
}

export interface ImportSessionContextValue {
  state: ImportSessionState;
  actions: ImportSessionActions;
}

export default function ImportSessionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();

  // ── session metadata ──
  // ── session metadata ──
  const [active, setActive] = useState(false);
  const [kind, setKind] = useState<'single' | 'bulk'>('single');
  const [mode, setMode] = useState<'admin' | 'faculty'>('admin');
  const [facultyId, setFacultyId] = useState<string>('');
  const [facultyName, setFacultyName] = useState<string>('');
  const [facultyList, setFacultyList] = useState<FacultyLite[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);

  // ── single-importer draft ──
  const [parsed, setParsed] = useState<ImportParsed | null>(null);
  const [classes, setClasses] = useState<ImportRow[]>([]);
  const [hours, setHours] = useState<ImportRow[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [nextId, setNextId] = useState(1);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [fileHash, setFileHash] = useState('');
  const [effDate, setEffDateState] = useState<string>('');
  const [identity, setIdentityState] = useState(false);
  const [uploadError, setUploadErrorState] = useState<string>('');
  const [confirming, setConfirming] = useState(false);

  // ── bulk-importer files ──
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [reviewId, setReviewId] = useState<string | null>(null);

  // refs kept so the one-at-a-time OCR pump survives re-renders / minimisation
  const itemsRef = useRef<ImportFile[]>([]);
  const pumping = useRef(false);
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const draftGenerationRef = useRef(0);
  const counter = useRef(1);
  const histories = useRef<Record<string, Promise<{ status: string; effectivityDate: string }[]>>>({});
  const callbacksRef = useRef<ImportSessionCallbacks>({});

  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_FILES = 10;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const setAll = (next: ImportFile[]) => { itemsRef.current = next; setFiles(next); };
  const patch = (id: string, p: Partial<ImportFile>) => setAll(itemsRef.current.map(i => (i.id === id ? { ...i, ...p } : i)));

  const facultyListRef = useRef<FacultyLite[]>([]);

  // ── helpers ──
  const setSession = (values: Partial<ImportSessionState>) => {
    setActive(true);
    if (values.kind !== undefined) setKind(values.kind);
    if (values.mode !== undefined) setMode(values.mode);
    if (values.facultyId !== undefined) setFacultyId(values.facultyId);
    if (values.facultyName !== undefined) setFacultyName(values.facultyName);
    if (values.facultyList !== undefined) setFacultyList(values.facultyList);
    if (values.minimized !== undefined) setMinimized(values.minimized);
    if (values.pendingOpen !== undefined) setPendingOpen(values.pendingOpen);
    if (values.parsed !== undefined) setParsed(values.parsed);
    if (values.classes !== undefined) setClasses(values.classes);
    if (values.hours !== undefined) setHours(values.hours);
    if (values.report !== undefined) setReport(values.report);
    if (values.busy !== undefined) setBusy(values.busy);
    if (values.reading !== undefined) setReading(values.reading);
    if (values.nextId !== undefined) setNextId(values.nextId);
    if (values.outcome !== undefined) setOutcome(values.outcome);
    if (values.fileHash !== undefined) setFileHash(values.fileHash);
    if (values.effDate !== undefined) setEffDateState(values.effDate);
    if (values.identity !== undefined) setIdentityState(values.identity);
    if (values.uploadError !== undefined) setUploadErrorState(values.uploadError);
    if (values.confirming !== undefined) setConfirming(values.confirming);
    if (values.files !== undefined) setFiles(values.files);
    if (values.problems !== undefined) setProblems(values.problems);
    if (values.skipped !== undefined) setSkipped(values.skipped);
    if (values.reviewId !== undefined) setReviewId(values.reviewId);
  };

  const resetDraft = () => {
    draftGenerationRef.current += 1;
    setParsed(null);
    setClasses([]);
    setHours([]);
    setReport(null);
    setOutcome(null);
    setFileHash('');
    setNextId(1);
    setEffDateState('');
    setIdentityState(false);
    setUploadErrorState('');
    setBusy(false);
    setReading(false);
    setConfirming(false);
  };

  const clear = () => {
    if (outcome === null) callbacksRef.current.onCancel?.();
    activeRef.current = false;
    generationRef.current += 1;
    draftGenerationRef.current += 1;
    setMinimized(false);
    setPendingOpen(false);
    setActive(false);
    setFacultyList([]);
    resetDraft();
    setFiles([]);
    setProblems([]);
    setSkipped(0);
    setReviewId(null);
    itemsRef.current = [];
    counter.current = 1;
    histories.current = {};
    facultyListRef.current = [];
    callbacksRef.current = {};
  };

  const begin = (
    nextKind: 'single' | 'bulk',
    nextMode: 'admin' | 'faculty',
    nextFacultyId: string,
    nextFacultyName: string,
    options?: ImportSessionStartOptions,
  ): boolean => {
    if (activeRef.current) {
      toast({ title: 'An import session is already active', description: 'Open or discard the current import before starting another.', status: 'warning', duration: 5000 });
      return false;
    }
    activeRef.current = true;
    generationRef.current += 1;
    draftGenerationRef.current += 1;
    callbacksRef.current = options?.callbacks || {};
    facultyListRef.current = options?.facultyList || [];
    setSession({
      kind: nextKind, mode: nextMode, facultyId: nextFacultyId, facultyName: nextFacultyName,
      facultyList: options?.facultyList || [],
      active: true, minimized: false, pendingOpen: false,
      parsed: null, classes: [], hours: [], report: null, busy: false, reading: false, nextId: 1,
      outcome: null, fileHash: '', effDate: '', identity: false, uploadError: '', confirming: false,
      files: [], problems: [], skipped: 0, reviewId: null,
    });
    itemsRef.current = [];
    counter.current = 1;
    histories.current = {};
    if (nextKind === 'bulk' && options?.files) {
      void addFiles(options.files);
    }
    return true;
  };

  const minimize = () => { setMinimized(true); setPendingOpen(false); };
  const restore = () => { setMinimized(false); setPendingOpen(false); };

  // ── single: upload PDF ──
  const uploadPdf = async (file: File | undefined) => {
    if (!file) return;
    const generation = ++draftGenerationRef.current;
    setUploadErrorState('');
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setUploadErrorState('Choose a PDF file.'); return; }
    if (file.size > MAX_BYTES) { setUploadErrorState('That PDF is larger than 10 MB.'); return; }
    setReading(true);
    try {
      const res = await authFetch(`${API}/api/schedule-import/preview?facultyId=${encodeURIComponent(facultyId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (generation !== draftGenerationRef.current) return;
      if (!res.ok) { setUploadErrorState(data.error || 'Could not read that PDF.'); return; }
      setParsed(data);
      setClasses(data.classes);
      setHours(data.consultationHours);
      setReport(null);
      setFileHash(data.fileHash || '');
      setEffDateState(data.metadata?.effectivityDate || '');
    } catch { if (generation === draftGenerationRef.current) setUploadErrorState('Could not reach the server.'); }
    finally { if (generation === draftGenerationRef.current) setReading(false); }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const generation = ++draftGenerationRef.current;
    try {
      const draft = JSON.parse(await file.text());
      const res = await authFetch(`${API}/api/schedule-import/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }),
      });
      const data = await res.json();
      if (generation !== draftGenerationRef.current) return;
      if (!res.ok) {
        toast({ title: 'Could not read the draft', description: data.error, status: 'error', duration: 5000 });
        return;
      }
      setParsed(data);
      setClasses(data.classes);
      setHours(data.consultationHours);
      setReport(null);
      setFileHash('');
      setEffDateState(data.metadata?.effectivityDate || '');
    } catch {
      if (generation === draftGenerationRef.current) {
        toast({ title: 'That file is not a schedule draft', description: 'Choose the JSON file the OCR program wrote.', status: 'error', duration: 5000 });
      }
    }
  };

  const editClass = (id: string, patch: Partial<ImportRow>) => {
    setClasses(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
    setReport(null);
  };
  const editHour = (id: string, patch: Partial<ImportRow>) => {
    setHours(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
    setReport(null);
  };
  const addClass = () => {
    setClasses(rs => [...rs, { id: `n${nextId}`, dayOfWeek: 1, startTime: '08:00', endTime: '09:00', subject: '', section: '', room: '', needsReview: false, reviewReasons: [] }]);
    setNextId(n => n + 1);
    setReport(null);
  };
  const addHour = () => {
    setHours(rs => [...rs, { id: `n${nextId}`, dayOfWeek: 1, startTime: '09:00', endTime: '10:00', label: 'CONSULTATION HOURS', needsReview: false, reviewReasons: [] }]);
    setNextId(n => n + 1);
    setReport(null);
  };
  const removeRow = (type: 'class' | 'consult', id: string) => {
    if (type === 'class') setClasses(rs => rs.filter(r => r.id !== id));
    else setHours(rs => rs.filter(r => r.id !== id));
    setReport(null);
  };
  const notifyApplied = () => callbacksRef.current.onApplied?.();
  const setIdentity = (checked: boolean) => { setIdentityState(checked); setReport(null); };
  const setEffDate = (date: string) => setEffDateState(date);

  // ── single: server re-check ──
  const check = async () => {
    const generation = draftGenerationRef.current;
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/schedule-import/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId, classes, consultationHours: hours, metadata: parsed?.metadata, workload: parsed?.workload, identityConfirmed: identity }),
      });
      const data = await res.json();
      if (generation !== draftGenerationRef.current) return;
      if (!res.ok) { toast({ title: 'Could not check the schedule', description: data.error, status: 'error', duration: 5000 }); return; }
      setReport(data);
    } catch { if (generation === draftGenerationRef.current) toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
    finally { if (generation === draftGenerationRef.current) setBusy(false); }
  };

  // ── single: confirm ──
  const confirm = async () => {
    const generation = draftGenerationRef.current;
    setConfirming(true);
    try {
      const res = await authFetch(`${API}/api/schedule-import/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId, classes, consultationHours: hours, metadata: parsed?.metadata, workload: parsed?.workload, identityConfirmed: identity,
            effectivityDate: effDate, scheduleFingerprint: report?.scheduleFingerprint, fileHash }),
      });
      const data = await res.json().catch(() => ({}));
      if (generation !== draftGenerationRef.current) return;
      if (!res.ok) {
        setReport(null);
        toast({ title: 'The schedule was not applied', description: data.error || 'Please check the schedule again.', status: 'error', duration: 8000, isClosable: true });
        return;
      }
      if (kind === 'bulk' && reviewId) {
        patch(reviewId, { importState: data.status === 'ACTIVE' ? 'imported' : 'scheduled', reviewDraft: undefined });
      }
      setOutcome({ status: data.status, effectivityDate: data.effectivityDate, counts: data.counts });
      callbacksRef.current.onDone?.(data.status);
      if (data.status === 'ACTIVE') callbacksRef.current.onApplied?.();
    } catch { if (generation === draftGenerationRef.current) toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
    finally { if (generation === draftGenerationRef.current) setConfirming(false); }
  };

  // ── bulk: add files ──
  const addFiles = async (incoming: File[]) => {
    const list = [...itemsRef.current];
    const issues: string[] = [];
    for (const file of incoming) {
      if (list.length >= MAX_FILES) { issues.push(`Only ${MAX_FILES} files at a time. The rest were left out.`); break; }
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { issues.push(`${file.name}: not a PDF.`); continue; }
      if (file.size > MAX_BYTES) { issues.push(`${file.name}: larger than 10 MB.`); continue; }
      if (list.some(i => i.file.name === file.name && i.file.size === file.size)) { issues.push(`${file.name}: already in the list.`); continue; }
      const match = matchFacultyByFilename(file.name, facultyListRef.current);
      const auto = match.status === 'matched';
      list.push({
        id: `f${counter.current++}`, file, match, facultyId: auto ? match.candidates[0]._id : '', ocr: auto ? 'queued' : 'waiting',
        error: '', data: null, fileHash: '', identity: 'unchecked', identityRead: '', alreadyImported: '', importState: 'pending',
      });
    }
    setAll(list);
    setProblems(issues);
    void pump();
  };

  // ── bulk: check one file (identity + duplicate history) ──
  const checkOne = async (id: string, generation: number) => {
    const it = itemsRef.current.find(i => i.id === id);
    if (generation !== generationRef.current || !it || !it.data || !it.facultyId) return;
    patch(id, { identity: 'checking', alreadyImported: '' });
    let identity: ImportFile['identity'] = 'unreadable', read = '';
    try {
      const res = await authFetch(`${API}/api/schedule-import/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId: it.facultyId, classes: it.data.classes, consultationHours: it.data.consultationHours, metadata: it.data.metadata, workload: it.data.workload, identityConfirmed: false }),
      });
      const rep = await res.json().catch(() => ({}));
      if (generation !== generationRef.current) return;
      if (res.ok && rep.identity && (rep.identity.status === 'match' || rep.identity.status === 'mismatch')) {
        identity = rep.identity.status; read = rep.identity.read || '';
      } else if (res.ok && rep.identity) { read = rep.identity.read || ''; }
    } catch { /* leave as unreadable */ }
    let already = '';
    if (it.fileHash) {
      const hist = await loadHistory(it.facultyId);
      if (generation !== generationRef.current) return;
      const hit = hist.find(h => h.fileHash === it.fileHash && ['ACTIVE', 'SCHEDULED', 'SUPERSEDED'].includes(h.status));
      if (hit) already = `This exact PDF was already imported (effective ${hit.effectivityDate}).`;
    }
    if (generation === generationRef.current) patch(id, { identity, identityRead: read, alreadyImported: already });
  };

  const loadHistory = (fid: string): Promise<{ status: string; effectivityDate: string; fileHash?: string }[]> => {
    if (!histories.current[fid]) {
      histories.current[fid] = authFetch(`${API}/api/schedule-import/history/${encodeURIComponent(fid)}`)
        .then(r => (r.ok ? r.json() : [])).catch(() => []);
    }
    return histories.current[fid];
  };

  const readOne = async (it: ImportFile, generation: number) => {
    let message = 'Could not read that PDF.';
    for (let attempt = 0; attempt < 4; attempt++) {
      if (generation !== generationRef.current) return;
      try {
        const res = await authFetch(`${API}/api/schedule-import/preview?facultyId=${encodeURIComponent(it.facultyId)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: it.file,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (generation !== generationRef.current) return;
          patch(it.id, { ocr: 'done', data, fileHash: data.fileHash || '', error: '' });
          await checkOne(it.id, generation);
          return;
        }
        message = data.error || message;
        if (data.code === 'OCR_BUSY' && attempt < 3) { await sleep(6000); continue; }
        break;
      } catch { message = 'Could not reach the server.'; break; }
    }
    if (generation === generationRef.current) patch(it.id, { ocr: 'failed', error: message });
  };

  const pump = async () => {
    if (pumping.current) return;
    pumping.current = true;
    const generation = generationRef.current;
    try {
      for (;;) {
        if (generation !== generationRef.current) break;
        const next = itemsRef.current.find(i => i.facultyId && i.ocr === 'queued');
        if (!next) break;
        patch(next.id, { ocr: 'reading' });
        await readOne(next, generation);
      }
    } finally {
      pumping.current = false;
      if (generation !== generationRef.current) void pump();
    }
  };

  const assignFaculty = (id: string, fid: string) => {
    const it = itemsRef.current.find(i => i.id === id);
    if (!it) return;
    if (it.data) {
      patch(id, { facultyId: fid, identity: fid ? 'checking' : 'unchecked', alreadyImported: '' });
      if (fid) void checkOne(id, generationRef.current);
    } else {
      patch(id, { facultyId: fid, ocr: fid ? 'queued' : 'waiting' });
      if (fid) void pump();
    }
  };
  const retryFile = (id: string) => { patch(id, { ocr: 'queued', error: '' }); void pump(); };
  const removeFile = (id: string) => { setAll(itemsRef.current.filter(i => i.id !== id)); setSkipped(n => n + 1); };
  const resetBulk = () => { resetDraft(); setAll([]); setProblems([]); setSkipped(0); setReviewId(null); histories.current = {}; };
  const openReview = (id: string) => {
    const item = itemsRef.current.find(i => i.id === id);
    if (!item || !item.data || !item.facultyId) return;
    const draft = item.reviewDraft;
    setFacultyId(item.facultyId);
    setFacultyName(facultyListRef.current.find(f => f._id === item.facultyId)?.name || '');
    setParsed(draft?.parsed || item.data);
    setClasses(draft?.classes || item.data.classes);
    setHours(draft?.hours || item.data.consultationHours);
    setReport(null);
    setIdentityState(draft?.identity || false);
    setFileHash(item.fileHash);
    setEffDateState(draft ? draft.effDate : item.data.metadata.effectivityDate || '');
    setOutcome(null);
    setReviewId(id);
  };
  const backToList = () => {
    if (kind !== 'bulk' || !reviewId || !parsed) return;
    patch(reviewId, {
      reviewDraft: { parsed, classes, hours, identity, effDate },
      importState: 'pending',
    });
    setReport(null);
    setOutcome(null);
    setReviewId(null);
  };
  const closeReview = () => {
    if (reviewId) patch(reviewId, { reviewDraft: undefined });
    resetDraft();
    setReviewId(null);
  };

  // ── beforeunload warning while there is unsaved work ──
  const hasWork = active && (kind === 'bulk'
    ? files.some(i => i.importState === 'pending')
    : outcome === null && (parsed !== null || classes.length > 0 || hours.length > 0 || reading || busy));
  useEffect(() => {
    if (!hasWork) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasWork]);

  // Clear a running import when a dashboard signs out.
  useEffect(() => {
    const onLogout = () => { clear(); };
    window.addEventListener('ccis-logout', onLogout);
    return () => window.removeEventListener('ccis-logout', onLogout);
  }, [clear]);

  const value = useMemo(() => ({
    state: {
      active, kind, mode, facultyId, facultyName, facultyList, minimized, pendingOpen,
      parsed, classes, hours, report, busy, reading, nextId, outcome, effDate, identity, uploadError, confirming,
      files, problems, skipped, reviewId, fileHash,
    },
    actions: {
      begin, minimize, restore, clear,
      uploadPdf, loadFile, check, confirm,
      editClass, editHour, addClass, addHour, removeRow,
      notifyApplied,
      setIdentity, setEffDate, resetDraft,
      setReviewId,
      openReview, backToList, closeReview,
      addFiles, assignFaculty, retryFile, removeFile, resetBulk,
    },
  }), [active, kind, mode, facultyId, facultyName, facultyList, minimized, pendingOpen, parsed, classes, hours, report, busy, reading, nextId, outcome, fileHash, effDate, identity, uploadError, confirming, files, problems, skipped, reviewId, begin, minimize, restore, clear, uploadPdf, loadFile, check, confirm, editClass, editHour, addClass, addHour, removeRow, setIdentity, setEffDate, resetDraft, setReviewId, openReview, backToList, closeReview, addFiles, assignFaculty, retryFile, removeFile, resetBulk]);

  return (
    <ImportSessionContext.Provider value={value}>{children}</ImportSessionContext.Provider>
  );
}
