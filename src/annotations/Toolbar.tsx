import { useEffect, useRef, useState } from 'react';
import { useZoom } from '@embedpdf/plugin-zoom/react';
import { useAnnotation } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import type { PdfRuntime } from '../pdf/engine';
import type { ToolId } from '../app/EditorShell';
import { SaveMenu } from './SaveMenu';
import { Icons, type IconName } from './icons';
import { RecentMenu } from '../app/RecentMenu';
import { SettingsMenu } from '../app/SettingsMenu';
import type { RecentMeta } from '../app/recent-store';
import { contentHistory } from '../content-edit/history';
import { useContentEditState } from '../content-edit/store';
import { Brand } from '../app/Brand';
import { appSettings, useAppSettings } from '../app/settings';
import { useDismiss } from '../shared/useDismiss';
import { useT, type MessageKey } from '../i18n';
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
}

/** Tool list. Labels and descriptions come from i18n: tool.<id> / tool.<id>.help */
const TOOLS: { id: ToolId; icon: IconName }[] = [
  { id: 'select', icon: 'select' },
  { id: 'content', icon: 'content' },
  { id: 'textJa', icon: 'text' },
  { id: 'callout', icon: 'callout' },
  { id: 'stamp', icon: 'stamp' },
  { id: 'image', icon: 'image' },
  { id: 'textComment', icon: 'note' },
  { id: 'highlight', icon: 'highlight' },
  { id: 'underline', icon: 'underline' },
  { id: 'strikeout', icon: 'strikeout' },
  { id: 'ink', icon: 'ink' },
  { id: 'square', icon: 'square' },
  { id: 'circle', icon: 'circle' },
  { id: 'line', icon: 'line' },
  { id: 'lineArrow', icon: 'arrow' },
];
const toolLabel = (id: ToolId) => `tool.${id}` as MessageKey;
const toolHelp = (id: ToolId) => `tool.${id}.help` as MessageKey;

type Tool = (typeof TOOLS)[number];

/** Tools folded into one button. The last used one is shown; switch with ▾ */
const GROUPS: { id: 'note' | 'markup' | 'shape'; members: ToolId[] }[] = [
  { id: 'note', members: ['callout', 'textComment'] },
  { id: 'markup', members: ['highlight', 'underline', 'strikeout'] },
  { id: 'shape', members: ['ink', 'square', 'circle', 'line', 'lineArrow'] },
];

/** Icon button. The label is kept for screen readers (tests also look for this string) */
export function IconButton({
  icon,
  label,
  title,
  active,
  ...rest
}: {
  icon: IconName;
  label: string;
  title?: string;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const Icon = Icons[icon];
  return (
    <button
      {...rest}
      className={`icon-btn${active ? ' active' : ''}${rest.className ? ' ' + rest.className : ''}`}
      title={title ? `${label} — ${title}` : label}
      aria-label={label}
    >
      <Icon />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function ToolGroup({
  group,
  tool,
  onSelectTool,
  disabled,
  disabledTitle,
}: {
  group: (typeof GROUPS)[number];
  tool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  disabled: boolean;
  disabledTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const settings = useAppSettings();
  const members = group.members.map((id) => TOOLS.find((t) => t.id === id)!);
  const remembered = members.find((m) => m.id === settings.groupTools[group.id]) ?? members[0];
  // If a tool in the group was selected (e.g. via shortcut), show it and remember it
  const shown = members.find((m) => m.id === tool) ?? remembered;
  useEffect(() => {
    if (shown.id !== remembered.id) appSettings.set({ groupTools: { ...appSettings.get().groupTools, [group.id]: shown.id } });
  }, [shown.id, remembered.id, group.id]);
  const pick = (m: Tool) => {
    setOpen(false);
    onSelectTool(m.id);
  };
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  return (
    <div ref={root} className="menu tool-group">
      <IconButton
        icon={shown.icon}
        label={t(toolLabel(shown.id))}
        title={disabledTitle ?? t(toolHelp(shown.id))}
        active={tool === shown.id}
        disabled={disabled}
        onClick={() => pick(shown)}
      />
      <button
        className="icon-btn group-caret"
        title={t('toolbar.groupPick', { group: t(`group.${group.id}`) })}
        aria-label={t('toolbar.groupKind', { group: t(`group.${group.id}`) })}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu-list tool-menu" onMouseLeave={() => setOpen(false)}>
          {members.map((m) => {
            const Icon = Icons[m.icon];
            return (
              <button key={m.id} aria-label={t(toolLabel(m.id))} className={m.id === shown.id ? 'active' : ''} onClick={() => pick(m)}>
                <span className="tool-menu-row">
                  <Icon />
                  <span className="menu-label">{t(toolLabel(m.id))}</span>
                </span>
                <span className="menu-help">{t(toolHelp(m.id))}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
          <IconButton
            icon="rotateLeft"
            label={tr('toolbar.rotateLeft')}
            title={onRotatePage ? tr('toolbar.rotateLeft.help') : tr('toolbar.rotate.blocked')}
            disabled={!onRotatePage || pagesBusy}
            onClick={() => onRotatePage?.(-1)}
          />
          <IconButton
            icon="rotateRight"
            label={tr('toolbar.rotateRight')}
            title={onRotatePage ? tr('toolbar.rotateRight.help') : tr('toolbar.rotate.blocked')}
            disabled={!onRotatePage || pagesBusy}
            onClick={() => onRotatePage?.(1)}
          />
          <span className="sep" />
          {TOOLS.map((t) => {
            if (t.id === 'content' && !contentEdit) return null; // content editing mode only
            const group = GROUPS.find((g) => g.members.includes(t.id));
            if (group && group.members[0] !== t.id) return null; // render the group at the position of its first member
            const disabled = !canAnnotate && t.id !== 'select' && t.id !== 'content';
            const disabledTitle = !canAnnotate && t.id !== 'select' ? tr('toolbar.annotateBlocked') : undefined;
            if (group) {
              return (
                <ToolGroup key={group.id} group={group} tool={tool} onSelectTool={onSelectTool} disabled={disabled} disabledTitle={disabledTitle} />
              );
            }
            return (
              <IconButton
                disabled={disabled}
                key={t.id}
                icon={t.icon}
                label={tr(toolLabel(t.id))}
                title={disabledTitle ?? tr(toolHelp(t.id))}
                active={tool === t.id}
                onClick={() => onSelectTool(t.id)}
              />
            );
          })}
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
          />
        </>
      )}
      {!documentId && <span className="spacer" />}
      <SettingsMenu />
    </div>
  );
}

function ZoomButtons({ documentId }: { documentId: string }) {
  const { state, provides } = useZoom(documentId);
  const t = useT();
  return (
    <>
      <IconButton icon="zoomOut" label={t('toolbar.zoomOut')} onClick={() => provides?.zoomOut()} />
      <span className="zoom">{Math.round(state.currentZoomLevel * 100)}%</span>
      <IconButton icon="zoomIn" label={t('toolbar.zoomIn')} onClick={() => provides?.zoomIn()} />
    </>
  );
}

/** Delete selected annotations, and Undo / Redo */
function EditButtons({ documentId, contentEdit }: { documentId: string; contentEdit: boolean }) {
  const { state, provides: annotations } = useAnnotation(documentId);
  const { provides: history } = useHistoryCapability();
  const t = useT();
  const [, bump] = useState(0);
  useEffect(() => history?.onHistoryChange(() => bump((n) => n + 1)), [history]);

  // In content editing mode, Undo/Redo target the content editing history
  const { history: ch } = useContentEditState();
  const canUndo = contentEdit ? ch.undo > 0 : !!history?.canUndo();
  const canRedo = contentEdit ? ch.redo > 0 : !!history?.canRedo();
  const undo = () => (contentEdit ? contentHistory.undo() : history?.undo());
  const redo = () => (contentEdit ? contentHistory.redo() : history?.redo());

  const selected = state.selectedUids;
  const deleteSelected = () => {
    if (!annotations) return;
    annotations.deleteAnnotations(
      annotations.getSelectedAnnotations().map((a) => ({ pageIndex: a.object.pageIndex, id: a.object.id })),
    );
  };
  return (
    <>
      <IconButton
        icon="trash"
        label={t('toolbar.delete')}
        title={t('toolbar.delete.help')}
        onClick={deleteSelected}
        disabled={selected.length === 0}
      />
      <IconButton
        icon="undo"
        label={t('toolbar.undo')}
        title="Ctrl+Z"
        onClick={undo}
        disabled={!canUndo}
      />
      <IconButton
        icon="redo"
        label={t('toolbar.redo')}
        title="Ctrl+Y"
        onClick={redo}
        disabled={!canRedo}
      />
    </>
  );
}
