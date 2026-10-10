import { useEffect, useRef, useState } from 'react';
import { templateName, type StampElement, type StampTemplate } from '../annotations/stamps/template';
import { putTemplate, removeTemplate } from '../annotations/stamps/template-store';
import { moveElement } from './StampCanvas';
import { uuid } from '../shared/uuid';
import { t as tr0, useT } from '../i18n';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type ElementKind = 'rect' | 'roundRect' | 'ellipse' | 'line' | 'text';

/** Initial shape of an added element (placed at the canvas center) */
function newElement(kind: ElementKind, t: StampTemplate): StampElement {
  const cx = t.width / 2;
  const cy = t.height / 2;
  const w = Math.min(30, t.width * 0.6);
  const h = Math.min(16, t.height * 0.6);
  const base = { id: uuid(), x: cx - w / 2, y: cy - h / 2, w, h };
  switch (kind) {
    case 'rect':
      return { ...base, type: 'rect', radius: 0, strokeWidth: 1.4, fill: false };
    case 'roundRect':
      return { ...base, type: 'rect', radius: 4, strokeWidth: 1.4, fill: false };
    case 'ellipse':
      return { ...base, type: 'ellipse', strokeWidth: 1.4, fill: false };
    case 'line':
      return { id: base.id, type: 'line', x1: cx - w / 2, y1: cy, x2: cx + w / 2, y2: cy, strokeWidth: 1.1 };
    case 'text':
      return { ...base, type: 'text', text: tr0('se.textDefault'), fontSize: 12, vertical: false, align: 'center' };
  }
}

/** A new stamp: a 60pt square with a frame filling it */
function blankTemplate(): StampTemplate {
  return {
    id: uuid(),
    name: tr0('se.newName'),
    width: 60,
    height: 60,
    color: 'red',
    updatedAt: 0,
    elements: [{ id: uuid(), type: 'rect', x: 0, y: 0, w: 60, h: 60, radius: 0, strokeWidth: 1.4, fill: false }],
  };
}

/**
 * The stamp being edited in the stamp editor: a copy of a built-in / saved stamp (or a new one),
 * the selected element, and whether there are unsaved changes
 */
export function useStampDraft(templates: StampTemplate[], onStatus: (msg: string) => void) {
  const tr = useT();
  const [draft, setDraft] = useState<StampTemplate>(() => clone(templates[0]));
  const [sourceId, setSourceId] = useState<string | null>(templates[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const source = templates.find((t) => t.id === sourceId);
  const isBuiltin = !!source?.builtin;
  const selected = draft.elements.find((e) => e.id === selectedId) ?? null;

  const edit = (patch: Partial<StampTemplate> | ((t: StampTemplate) => StampTemplate)) => {
    setDraft((t) => (typeof patch === 'function' ? patch(t) : { ...t, ...patch }));
    setDirty(true);
  };
  const editElement = (el: StampElement) =>
    edit((t) => ({ ...t, elements: t.elements.map((e) => (e.id === el.id ? el : e)) }));

  const switchTo = (next: StampTemplate, nextSourceId: string | null, nextDirty: boolean) => {
    setDraft(next);
    setSourceId(nextSourceId);
    setSelectedId(null);
    setDirty(nextDirty);
  };
  const confirmDiscard = () => !dirty || window.confirm(tr('se.confirmDiscard'));
  const load = (t: StampTemplate) => confirmDiscard() && switchTo(clone(t), t.id, false);
  const startNew = () => confirmDiscard() && switchTo(blankTemplate(), null, true);
  /** Start editing a built-in or saved stamp as a copy with a new ID */
  const duplicate = () => {
    const copy = clone(draft);
    copy.id = uuid();
    copy.name = tr('se.copyName', { name: templateName(draft) });
    copy.builtin = undefined;
    copy.elements = copy.elements.map((e) => ({ ...e, id: uuid() }));
    setDraft(copy);
    setSourceId(null);
    setDirty(true);
  };
  const save = async () => {
    // Built-ins cannot be overwritten, so save as a copy
    const t = isBuiltin ? { ...draft, id: uuid(), builtin: undefined } : draft;
    await putTemplate(t);
    setDraft(t);
    setSourceId(t.id);
    setDirty(false);
    onStatus(tr('se.saved', { name: t.name }));
  };
  const remove = async () => {
    if (!source || isBuiltin) return;
    if (!window.confirm(tr('se.confirmDelete', { name: source.name }))) return;
    await removeTemplate(source.id);
    switchTo(blankTemplate(), null, false);
  };

  const addElement = (kind: ElementKind) => {
    const el = newElement(kind, draft);
    edit((t) => ({ ...t, elements: [...t.elements, el] }));
    setSelectedId(el.id);
  };
  const removeSelected = () => {
    if (!selected) return;
    edit((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== selected.id) }));
    setSelectedId(null);
  };
  const reorder = (dir: -1 | 1) => {
    if (!selected) return;
    edit((t) => {
      const i = t.elements.indexOf(selected);
      const j = i + dir;
      if (j < 0 || j >= t.elements.length) return t;
      const next = [...t.elements];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...t, elements: next };
    });
  };

  // Keyboard: arrows move (Shift = 5pt), Delete removes. The listener stays; it reads the latest render's handlers
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (!selected || (e.target as HTMLElement).matches('input, textarea, select')) return;
    const step = e.shiftKey ? 5 : 0.5;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (d[e.key]) {
      e.preventDefault();
      editElement(moveElement(selected, ...d[e.key]));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return {
    draft,
    sourceId,
    source,
    isBuiltin,
    dirty,
    selected,
    selectedId,
    setSelectedId,
    edit,
    editElement,
    load,
    startNew,
    duplicate,
    save,
    remove,
    addElement,
    removeSelected,
    reorder,
  };
}
