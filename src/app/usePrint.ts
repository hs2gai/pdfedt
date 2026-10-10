import { useState } from 'react';
import { useActiveDocument } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { printDocument } from '../viewer/print';
import { errorText } from '../shared/errors';
import { useT } from '../i18n';

/** Printing renders every page first; one run at a time */
export function usePrint({ canPrint, onStatus }: { canPrint: boolean; onStatus: (msg: string) => void }) {
  const t = useT();
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const { provides: annotations } = useAnnotationCapability();
  const { provides: renderCap } = useRenderCapability();
  const [printing, setPrinting] = useState(false);

  const print = async () => {
    const doc = activeDocument?.document;
    if (!activeDocumentId || !doc || !renderCap || printing) return;
    if (!canPrint) return onStatus(t('toolbar.print.blocked'));
    setPrinting(true);
    try {
      // Flush annotation changes so the page images include them
      await annotations?.forDocument(activeDocumentId).commit().toPromise();
      await printDocument(renderCap, doc, (done, total) => onStatus(t('print.preparing', { done, total })));
      onStatus('');
    } catch (e) {
      onStatus(t('print.failed', { message: errorText(e) }));
    } finally {
      setPrinting(false);
    }
  };

  return { printing, print };
}
