import { useEffect, useRef } from 'react';
import type { PdfRuntime } from '../../pdf/engine';
import { buildAppearance } from '../../pdf/appearance';
import { renderAppearance } from '../../pdf/render-appearance';
import { subsetFonts } from '../../pdf/fonts/ja-font';
import { collapseEmptyRows, templateAppearanceSpec, templateTextsByFont, type StampTemplate } from './template';

interface Props {
  runtime: PdfRuntime;
  template: StampTemplate;
  values: Record<string, string>;
  color: string;
  /** Display scale (pt → CSS px) */
  scale: number;
  className?: string;
}

/** Preview of a template rendered by PDFium (looks exactly like the stamped result) */
export function StampPreview({ runtime, template, values, color, scale, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = window.devicePixelRatio || 1;
  // Draw at the size after collapsing empty rows
  const size = collapseEmptyRows(template, values);
  const w = Math.round(size.width * scale);
  const h = Math.round(size.height * scale);
  // Compare by content so that we do not redraw when the caller rebuilds `values` on every render
  const signature = JSON.stringify([template, values, color, scale, dpr]);

  useEffect(() => {
    let alive = true;
    void subsetFonts(templateTextsByFont(template, values)).then((fonts) => {
      if (!alive || !canvas.current) return;
      const spec = templateAppearanceSpec(template, values, color, fonts);
      const image = renderAppearance(runtime.pdfium, buildAppearance(runtime.pdfium, spec), scale * dpr);
      const ctx = canvas.current.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.current.width, canvas.current.height);
      ctx.putImageData(image, 0, 0);
    });
    return () => {
      alive = false;
    };
  }, [runtime, signature]);

  return (
    <canvas
      ref={canvas}
      className={className}
      width={Math.round(w * dpr)}
      height={Math.round(h * dpr)}
      style={{ width: w, height: h }}
    />
  );
}
