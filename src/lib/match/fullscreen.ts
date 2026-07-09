import { refreshGameScale } from '../../game/main';

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  return Boolean(
    document.fullscreenEnabled ||
      el.requestFullscreen ||
      el.webkitRequestFullscreen,
  );
}

function getFullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreenActive(): boolean {
  return getFullscreenElement() !== null;
}

export async function toggleFullscreen(target: HTMLElement): Promise<boolean> {
  if (!isFullscreenSupported()) return false;

  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
    webkitFullscreenElement?: Element | null;
  };
  const el = target as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };

  if (getFullscreenElement()) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    }
    return false;
  }

  if (el.requestFullscreen) {
    await el.requestFullscreen();
  } else if (el.webkitRequestFullscreen) {
    await el.webkitRequestFullscreen();
  }
  return true;
}

let wired = false;

export function wireFullscreenScaleRefresh(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;

  document.addEventListener('fullscreenchange', () => {
    refreshGameScale();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    refreshGameScale();
  });
}
