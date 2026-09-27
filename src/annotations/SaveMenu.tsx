import { useRef, useState } from 'react';
import { useDismiss } from '../shared/useDismiss';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import type { PdfRuntime } from '../pdf/engine';
import { exportDocument } from '../pdf/export';
import { Icons } from './icons';
import { pickSaveTarget, writeSaveTarget } from '../pdf/download';
import { useT } from '../i18n';
import { ProtectDialog } from './ProtectDialog';

interface Props {
  runtime: PdfRuntime;
  documentId: string;
  documentName: string;
  onStatus: (msg: string) => void;
  /** Whether the content was rewritten in content editing mode (skip incremental save and use a new name) */
  contentEdited?: boolean;
}

type Kind = 'incremental' | 'full' | 'flatten';

/** Save kinds. Labels and descriptions come from i18n: save.<kind> / save.<kind>.help */
const KINDS: { kind: Kind; suffix: string }[] = [
  { kind: 'incremental', suffix: '_a' },
  { kind: 'full', suffix: '_n' },
  { kind: 'flatten', suffix: '_f' },
];

export function SaveMenu({ runtime, documentId, documentName, onStatus, contentEdited }: Props) {
  const { provides: annotations } = useAnnotationCapability();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  /** `newPassword`: protect the result with an open password (full / flatten only) */
  const run = async (kind: Kind, newPassword?: string) => {
    setOpen(false);
    setBusy(true);
    try {
      // Open the save dialog right after the click (it is refused outside the user-activation window)
      const base = documentName.replace(/\.pdf$/i, '');
      // Suffix per save kind: _a = annotated / _n = new file / _f = flattened
      const target = await pickSaveTarget(`${base}${KINDS.find((k) => k.kind === kind)!.suffix}.pdf`);
      if (target.kind === 'cancelled') {
        onStatus(t('save.cancelled'));
        return;
      }
      // Flush uncommitted annotation changes to PDFium before exporting
      await annotations?.forDocument(documentId).commit().toPromise();
      const bytes = exportDocument(runtime, documentId, kind, newPassword);
      await writeSaveTarget(target, bytes);
      onStatus(t('save.done', { size: (bytes.byteLength / 1024).toFixed(0) }));
    } catch (e) {
      onStatus(t('save.failed', { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="menu">
      <button className="primary save-btn" onClick={() => setOpen((v) => !v)} disabled={busy}>
        <Icons.save />
        {busy ? t('save.busy') : t('save.button')}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu-list" onMouseLeave={() => setOpen(false)}>
          {KINDS.map((k) => {
            const blocked = contentEdited && k.kind === 'incremental';
            return (
              <button key={k.kind} onClick={() => run(k.kind)} disabled={blocked}>
                <span className="menu-label">{t(`save.${k.kind}`)}</span>
                <span className="menu-help">{blocked ? t('save.incrementalBlocked') : t(`save.${k.kind}.help`)}</span>
              </button>
            );
          })}
          <button
            onClick={() => {
              setOpen(false);
              setProtecting(true);
            }}
          >
            <span className="menu-label">{t('save.protect')}</span>
            <span className="menu-help">{t('save.protect.help')}</span>
          </button>
        </div>
      )}
      {protecting && (
        <ProtectDialog
          onCancel={() => setProtecting(false)}
          onSubmit={(kind, password) => {
            setProtecting(false);
            void run(kind, password);
          }}
        />
      )}
    </div>
  );
}
