import { useEffect, useRef, useState } from 'react';
import type { ToolId } from '../app/EditorShell';
import { Icons, type IconName } from './icons';
import { IconButton } from './IconButton';
import { appSettings, useAppSettings } from '../app/settings';
import { useDismiss } from '../shared/useDismiss';
import { useT, type MessageKey } from '../i18n';

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

interface Props {
  tool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  /** Whether content editing mode is on (the "Content" tool appears only then) */
  contentEdit: boolean;
  /** Annotating is allowed (only select / content stay usable otherwise) */
  canAnnotate: boolean;
}

/** The tool buttons of the toolbar, with grouped tools folded into one button each */
export function ToolButtons({ tool, onSelectTool, contentEdit, canAnnotate }: Props) {
  const t = useT();
  return TOOLS.map((item) => {
    if (item.id === 'content' && !contentEdit) return null;
    const group = GROUPS.find((g) => g.members.includes(item.id));
    if (group && group.members[0] !== item.id) return null; // render the group at the position of its first member
    const disabled = !canAnnotate && item.id !== 'select' && item.id !== 'content';
    const disabledTitle = !canAnnotate && item.id !== 'select' ? t('toolbar.annotateBlocked') : undefined;
    if (group) {
      return (
        <ToolGroup
          key={group.id}
          group={group}
          tool={tool}
          onSelectTool={onSelectTool}
          disabled={disabled}
          disabledTitle={disabledTitle}
        />
      );
    }
    return (
      <IconButton
        disabled={disabled}
        key={item.id}
        icon={item.icon}
        label={t(toolLabel(item.id))}
        title={disabledTitle ?? t(toolHelp(item.id))}
        active={tool === item.id}
        onClick={() => onSelectTool(item.id)}
      />
    );
  });
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
    if (shown.id !== remembered.id)
      appSettings.set({ groupTools: { ...appSettings.get().groupTools, [group.id]: shown.id } });
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
              <button
                key={m.id}
                aria-label={t(toolLabel(m.id))}
                className={m.id === shown.id ? 'active' : ''}
                onClick={() => pick(m)}
              >
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
