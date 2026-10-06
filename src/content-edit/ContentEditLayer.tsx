import { objectKey } from './page-objects';
import { pickableObjects, useContentEditState } from './store';

/**
 * On-page display for content editing mode (selection frames, movement while dragging, marquee selection).
 * Pointer handling is done by the interaction manager, so this layer only draws.
 */
export function ContentEditLayer({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const { objects, selection, dragDelta, marquee, showBackground } = useContentEditState();
  const list = pickableObjects(objects[pageIndex] ?? [], showBackground);
  const selected = selection?.pageIndex === pageIndex ? new Set(selection.keys) : new Set<string>();
  const dx = (dragDelta?.dx ?? 0) * scale;
  const dy = (dragDelta?.dy ?? 0) * scale;

  return (
    <div className="content-edit-layer" aria-hidden="true">
      {list.map((o) => {
        const key = objectKey(o);
        const isSel = selected.has(key);
        return (
          <div
            key={key}
            className={`ce-object ce-${o.type}${o.background ? ' ce-background' : ''}${isSel ? ' selected' : ''}`}
            style={{
              left: o.rect.origin.x * scale + (isSel ? dx : 0),
              top: o.rect.origin.y * scale + (isSel ? dy : 0),
              width: Math.max(2, o.rect.size.width * scale),
              height: Math.max(2, o.rect.size.height * scale),
            }}
          />
        );
      })}
      {marquee && marquee.pageIndex === pageIndex && (
        <div
          className="ce-marquee"
          style={{
            left: marquee.rect.origin.x * scale,
            top: marquee.rect.origin.y * scale,
            width: marquee.rect.size.width * scale,
            height: marquee.rect.size.height * scale,
          }}
        />
      )}
    </div>
  );
}
