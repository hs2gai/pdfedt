import type { PdfRuntime } from '../pdf/engine';
import type { ToolId } from '../app/EditorShell';
import { SaveMenu } from './SaveMenu';
import { IconButton } from './IconButton';
import { ToolButtons } from './ToolButtons';
import { EditButtons, ZoomButtons } from './EditButtons';
import { RecentMenu } from '../app/RecentMenu';
import { SettingsMenu } from '../app/SettingsMenu';
import type { RecentMeta } from '../app/recent-store';
import { Brand } from '../app/Brand';
import { useT } from '../i18n';
import { PageNavigator } from '../viewer/PageNavigator';

interface Props {
  runtime: PdfRuntime;
  documentId: string | null;
  documentName?: string;
  tool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onOpen: () => void;
  onOpenRecent: (meta: RecentMeta) => void;
  onStatus: (msg: string) => void;
  showThumbs: boolean;
  onToggleThumbs: () => void;
  contentEdit: boolean;
  contentEdited: boolean;
  onToggleContentEdit: () => void;
  /** Document permissions (permission bits of an encrypted document). Disables buttons for forbidden operations */
  canAnnotate: boolean;
  canModify: boolean;
  /** Rotates the current page by quarter turns. Omitted when pages cannot be changed (content editing, permissions, signatures) */
  onRotatePage?: (quarterTurns: 1 | -1) => void;
  /** A page operation is running (rotate buttons wait for it) */
  pagesBusy?: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  /** Whether the document allows printing */
  canPrint: boolean;
  /** Page images are being prepared for printing */
  printing: boolean;
  onPrint: () => void;
  /** Ask to revert to the file as first opened (in the save menu) */
  onReset: () => void;
}

const ROTATIONS = [
  { turns: -1, icon: 'rotateLeft', label: 'toolbar.rotateLeft', help: 'toolbar.rotateLeft.help' },
  { turns: 1, icon: 'rotateRight', label: 'toolbar.rotateRight', help: 'toolbar.rotateRight.help' },
] as const;

export function Toolbar({
  runtime,
  documentId,
  documentName,
  tool,
  onSelectTool,
  onOpen,
  onOpenRecent,
  onStatus,
  showThumbs,
  onToggleThumbs,
  contentEdit,
  contentEdited,
  onToggleContentEdit,
  canAnnotate,
  canModify,
  onRotatePage,
  pagesBusy,
  searchOpen,
  onToggleSearch,
  canPrint,
  printing,
  onPrint,
  onReset,
}: Props) {
  const tr = useT();
  return (
    <div className="toolbar">
      <Brand />
      <span className="sep" />
      <IconButton icon="open" label={tr('toolbar.open')} title={tr('toolbar.open.help')} onClick={onOpen} />
      <RecentMenu onOpen={onOpenRecent} />
      {documentId && (
        <>
          <IconButton
            icon="pages"
            label={tr('toolbar.pages')}
            title={tr('toolbar.pages.help')}
            active={showThumbs}
            onClick={onToggleThumbs}
          />
          <PageNavigator documentId={documentId} />
          <span className="sep" />
          <ZoomButtons documentId={documentId} />
          {ROTATIONS.map((r) => (
            <IconButton
              key={r.icon}
              icon={r.icon}
              label={tr(r.label)}
              title={onRotatePage ? tr(r.help) : tr('toolbar.rotate.blocked')}
              disabled={!onRotatePage || pagesBusy}
              onClick={() => onRotatePage?.(r.turns)}
            />
          ))}
          <span className="sep" />
          <ToolButtons tool={tool} onSelectTool={onSelectTool} contentEdit={contentEdit} canAnnotate={canAnnotate} />
          <span className="sep" />
          <EditButtons documentId={documentId} contentEdit={contentEdit && tool === 'content'} />
          <span className="sep" />
          <IconButton
            icon="edit"
            label={contentEdit ? tr('toolbar.contentEdit.exit') : tr('toolbar.contentEdit')}
            title={
              !canModify
                ? tr('toolbar.contentEdit.blocked')
                : contentEdit
                  ? tr('toolbar.contentEdit.back')
                  : tr('toolbar.contentEdit.help')
            }
            disabled={!canModify}
            active={contentEdit}
            className={contentEdit ? 'danger' : undefined}
            onClick={onToggleContentEdit}
          />
          <span className="spacer" />
          <span className="doc-name" title={documentName}>
            {documentName}
          </span>
          <IconButton
            icon="search"
            label={tr('toolbar.search')}
            title={tr('toolbar.search.help')}
            active={searchOpen}
            onClick={onToggleSearch}
          />
          <IconButton
            icon="print"
            label={tr('toolbar.print')}
            title={canPrint ? tr('toolbar.print.help') : tr('toolbar.print.blocked')}
            disabled={!canPrint || printing}
            onClick={onPrint}
          />
          <SaveMenu
            runtime={runtime}
            documentId={documentId}
            documentName={documentName ?? 'document.pdf'}
            onStatus={onStatus}
            contentEdited={contentEdited}
            onReset={onReset}
          />
        </>
      )}
      {!documentId && <span className="spacer" />}
      <SettingsMenu />
    </div>
  );
}
