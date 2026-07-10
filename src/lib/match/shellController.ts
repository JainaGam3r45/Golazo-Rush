import type { ShellState, MatchMode, HubSubview } from './shellState.ts';

export type ShellControllerOptions = {
  root: HTMLElement;
  onStateChange?: (state: ShellState) => void;
};

export type ShellController = {
  getState(): ShellState;
  getMatchMode(): MatchMode;
  getHubSubview(): HubSubview;
  setState(state: ShellState): void;
  setMatchMode(mode: MatchMode): void;
  setHubSubview(view: HubSubview): void;
  setCssImmersive(enabled: boolean): void;
  dispose(): void;
};

function placeOnlinePanel(root: HTMLElement, state: ShellState, hubSubview: HubSubview) {
  const panel = root.querySelector<HTMLElement>('[data-online-room]');
  const hubSlot = root.querySelector<HTMLElement>('[data-online-slot-hub]');
  const roomSlot = root.querySelector<HTMLElement>('[data-online-slot-room]');
  if (!panel || !hubSlot || !roomSlot) return;

  if (state === 'room') {
    if (panel.parentElement !== roomSlot) roomSlot.appendChild(panel);
    panel.hidden = false;
  } else if (state === 'hub' && hubSubview === 'online') {
    if (panel.parentElement !== hubSlot) hubSlot.appendChild(panel);
    panel.hidden = false;
  } else if (state === 'connectingMatch' || state === 'match' || state === 'results') {
    panel.hidden = true;
  } else {
    panel.hidden = true;
  }
}

export function createShellController(options: ShellControllerOptions): ShellController {
  const { root } = options;
  let state: ShellState = 'boot';
  let matchMode: MatchMode = null;
  let hubSubview: HubSubview = 'cards';
  let disposed = false;

  function applyDom() {
    if (disposed) return;
    root.dataset.shellState = state;
    root.dataset.matchMode = matchMode ?? '';
    root.dataset.hubSubview = hubSubview;

    for (const panel of root.querySelectorAll<HTMLElement>('[data-shell-panel]')) {
      const panelState = panel.dataset.shellPanel;
      panel.hidden = panelState !== state;
    }

    const hub = root.querySelector<HTMLElement>('[data-shell-panel="hub"]');
    if (hub && state === 'hub') {
      for (const sub of hub.querySelectorAll<HTMLElement>('[data-hub-subview]')) {
        sub.hidden = sub.dataset.hubSubview !== hubSubview;
      }
    }

    placeOnlinePanel(root, state, hubSubview);
    options.onStateChange?.(state);
  }

  applyDom();

  return {
    getState() {
      return state;
    },
    getMatchMode() {
      return matchMode;
    },
    getHubSubview() {
      return hubSubview;
    },
    setState(next) {
      if (disposed) return;
      state = next;
      applyDom();
    },
    setMatchMode(mode) {
      if (disposed) return;
      matchMode = mode;
      applyDom();
    },
    setHubSubview(view) {
      if (disposed) return;
      hubSubview = view;
      applyDom();
    },
    setCssImmersive(enabled) {
      if (disposed) return;
      root.classList.toggle('game-shell--immersive-css', enabled);
    },
    dispose() {
      disposed = true;
    },
  };
}
