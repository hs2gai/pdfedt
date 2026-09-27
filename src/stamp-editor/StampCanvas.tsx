import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfRuntime } from '../pdf/engine';
import { StampPreview } from '../annotations/stamps/StampPreview';
import { bboxOf, type StampElement, type StampTemplate } from '../annotations/stamps/template';

/** Which side of the element's bbox to move (-1: left/top, 1: right/bottom, 0: unchanged) */
const HANDLES: { id: string; dx: -1 | 0 | 1; dy: -1 | 0 | 1; cursor: string }[] = [
  { id: 'nw', dx: -1, dy: -1, cursor: 'nwse-resize' },
  { id: 'n', dx: 0, dy: -1, cursor: 'ns-resize' },
  { id: 'ne', dx: 1, dy: -1, cursor: 'nesw-resize' },
  { id: 'e', dx: 1, dy: 0, cursor: 'ew-resize' },
  { id: 'se', dx: 1, dy: 1, cursor: 'nwse-resize' },
  { id: 's', dx: 0, dy: 1, cursor: 'ns-resize' },
  { id: 'sw', dx: -1, dy: 1, cursor: 'nesw-resize' },
  { id: 'w', dx: -1, dy: 0, cursor: 'ew-resize' },
];

const snap = (v: number) => Math.round(v * 2) / 2;
const MIN_SIZE = 2;

/** Translate the element by dx, dy */
export function moveElement(el: StampElement, dx: number, dy: number): StampElement {
  if (el.type === 'line') {
    return { ...el, x1: snap(el.x1 + dx), y1: snap(el.y1 + dy), x2: snap(el.x2 + dx), y2: snap(el.y2 + dy) };
  }
  return { ...el, x: snap(el.x + dx), y: snap(el.y + dy) };
}

/** Resize by moving a bbox edge (lines move their end points directly) */
function resizeElement(
  start: StampElement,
  handle: (typeof HANDLES)[number] | { id: 'p1' | 'p2' },
  dx: number,
  dy: number,
): StampElement {
  if (start.type === 'line') {
    if (handle.id === 'p1') return { ...start, x1: snap(start.x1 + dx), y1: snap(start.y1 + dy) };
    return { ...start, x2: snap(start.x2 + dx), y2: snap(start.y2 + dy) };
  }
  const h = handle as (typeof HANDLES)[number];
  let { x, y, w, hgt } = { x: start.x, y: start.y, w: start.w, hgt: start.h };
  if (h.dx === -1) {
    const nx = Math.min(snap(x + dx), x + w - MIN_SIZE);
    w += x - nx;
    x = nx;
  } else if (h.dx === 1) w = Math.max(MIN_SIZE, snap(w + dx));
  if (h.dy === -1) {
    const ny = Math.min(snap(y + dy), y + hgt - MIN_SIZE);
    hgt += y - ny;
    y = ny;
  } else if (h.dy === 1) hgt = Math.max(MIN_SIZE, snap(hgt + dy));
  return { ...start, x, y, w, h: hgt };
}

interface Props {
  runtime: PdfRuntime;
  template: StampTemplate;
  /** Values filled into the preview */
  values: Record<string, string>;
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (el: StampElement) => void;
}

/**
 * Editing canvas. PDFium's actual rendering below, SVG frames and handles on top.
 * Drag to move, handles to resize (end points for lines). Coordinates are pt, top-left origin.
 */
export function StampCanvas({ runtime, template, values, scale, selectedId, onSelect, onChange }: Props) {
  const gesture = useRef<{ start: StampElement; handle: { id: string } | null; x: number; y: number } | null>(null);
  const W = template.width * scale;
  const H = template.height * scale;

  const begin = (e: ReactPointerEvent, el: StampElement, handle: { id: string } | null) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    onSelect(el.id);
    gesture.current = { start: el, handle, x: e.clientX, y: e.clientY };
  };
  const move = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = (e.clientX - g.x) / scale;
    const dy = (e.clientY - g.y) / scale;
    const h = g.handle && (HANDLES.find((x) => x.id === g.handle!.id) ?? (g.handle as { id: 'p1' | 'p2' }));
    onChange(h ? resizeElement(g.start, h, dx, dy) : moveElement(g.start, dx, dy));
  };
  const end = () => {
    gesture.current = null;
  };

  return (
    <div className="se-canvas-wrap" style={{ width: W, height: H }} onPointerDown={() => onSelect(null)}>
      <StampPreview runtime={runtime} template={template} values={values} color={template.color} scale={scale} />
      <svg className="se-overlay" width={W} height={H} viewBox={`0 0 ${template.width} ${template.height}`}>
        {template.elements.map((el) => {
          const b = bboxOf(el);
          const selected = el.id === selectedId;
          return (
            <g key={el.id} className={selected ? 'se-el selected' : 'se-el'}>
              {el.type === 'line' ? (
                <line
                  x1={el.x1}
                  y1={el.y1}
                  x2={el.x2}
                  y2={el.y2}
                  className="se-hit"
                  onPointerDown={(e) => begin(e, el, null)}
                  onPointerMove={move}
                  onPointerUp={end}
                />
              ) : (
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  className="se-hit"
                  onPointerDown={(e) => begin(e, el, null)}
                  onPointerMove={move}
                  onPointerUp={end}
                />
              )}
              {selected &&
                (el.type === 'line'
                  ? (['p1', 'p2'] as const).map((id) => (
                      <circle
                        key={id}
                        cx={id === 'p1' ? el.x1 : el.x2}
                        cy={id === 'p1' ? el.y1 : el.y2}
                        r={3 / scale}
                        className="se-handle"
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => begin(e, el, { id })}
                        onPointerMove={move}
                        onPointerUp={end}
                      />
                    ))
                  : HANDLES.map((h) => (
                      <rect
                        key={h.id}
                        x={b.x + (b.w * (h.dx + 1)) / 2 - 3 / scale}
                        y={b.y + (b.h * (h.dy + 1)) / 2 - 3 / scale}
                        width={6 / scale}
                        height={6 / scale}
                        className="se-handle"
                        style={{ cursor: h.cursor }}
                        onPointerDown={(e) => begin(e, el, h)}
                        onPointerMove={move}
                        onPointerUp={end}
                      />
                    )))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
