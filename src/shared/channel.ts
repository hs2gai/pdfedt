/**
 * Tiny pub/sub for components far apart in the React tree
 * (e.g. the "Edit" button in the selection menu → the tool that owns the editing UI).
 */
export function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    emit: (value: T) => listeners.forEach((l) => l(value)),
    on(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
