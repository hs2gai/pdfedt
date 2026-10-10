/** Message of a caught value, for the status bar */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
