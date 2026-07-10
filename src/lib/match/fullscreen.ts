import { refreshGameScale } from './gameBridge';

type DocWithWebkit = Document & {
  webkitExitFullscreen?: () => Promise<void>;
  webkitFullscreenElement?: Element | null;
};

type ElWithWebkit = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  requestFullscreen: (options?: FullscreenOptions) => Promise<void>;
};

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as ElWithWebkit;
  return Boolean(
    document.fullscreenEnabled ||
      el.requestFullscreen ||
      el.webkitRequestFullscreen,
  );
}

function getFullscreenElement(): Element | null {
  const doc = document as DocWithWebkit;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreenActive(): boolean {
  return getFullscreenElement() !== null;
}

export function isShellFullscreen(shell: HTMLElement | null): boolean {
  if (!shell) return false;
  return getFullscreenElement() === shell;
}

export async function enterFullscreen(target: HTMLElement): Promise<boolean> {
  if (!isFullscreenSupported()) return false;
  if (isShellFullscreen(target)) return true;

  const el = target as ElWithWebkit;
  const opts: FullscreenOptions = { navigationUI: 'hide' };

  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen(opts);
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen(opts);
    } else {
      return false;
    }
  } catch {
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }

  return isShellFullscreen(target);
}

export async function exitFullscreen(): Promise<void> {
  if (!getFullscreenElement()) return;
  const doc = document as DocWithWebkit;
  if (document.exitFullscreen) {
    await document.exitFullscreen();
  } else if (doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen();
  }
}

/** @deprecated Prefer enterFullscreen / exitFullscreen. Kept for callers that toggle. */
export async function toggleFullscreen(target: HTMLElement): Promise<boolean> {
  if (getFullscreenElement()) {
    await exitFullscreen();
    return false;
  }
  return enterFullscreen(target);
}

export type FullscreenWireHandle = {
  dispose(): void;
};

/**
 * Shell-owned fullscreenchange wiring. Always refreshes game scale.
 * Call dispose on shell teardown to avoid duplicate listeners.
 */
export function wireFullscreenScaleRefresh(
  onChange?: (active: boolean) => void,
): FullscreenWireHandle {
  if (typeof document === 'undefined') {
    return { dispose() {} };
  }

  const handler = () => {
    refreshGameScale();
    onChange?.(isFullscreenActive());
  };

  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);

  return {
    dispose() {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    },
  };
}
