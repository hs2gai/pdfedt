import { useState, type DragEvent } from 'react';

/** Accepts PDF drag & drop. Styles switch on the data-dragging attribute */
export function useDropZone(onFile: (file: File) => void) {
  const [dragging, setDragging] = useState(false);
  return {
    'data-dragging': dragging || undefined,
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!dragging) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (file) onFile(file);
    },
  };
}
