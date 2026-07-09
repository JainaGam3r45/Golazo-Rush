let refreshScale: (() => void) | null = null;

export function registerGameScaleRefresh(fn: (() => void) | null): void {
  refreshScale = fn;
}

export function refreshGameScale(): void {
  refreshScale?.();
}
