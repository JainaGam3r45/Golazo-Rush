import {
  clampLineupSlot,
  cloneDefaultLineup,
  type CustomLineup,
  type LineupSlot,
  LINEUP_OUTFIELD_COUNT,
} from './lineup';

export type LineupEditorHandle = {
  getLineup(): CustomLineup;
  setLineup(lineup: CustomLineup): void;
  reset(): void;
  destroy(): void;
};

type Options = {
  initial?: CustomLineup;
  onChange?: (lineup: CustomLineup) => void;
};

/**
 * Mounts a drag-to-place 11v11 outfield editor into `root`.
 * Positions are normalized to the home half (nx toward attack).
 */
export function mountLineupEditor(root: HTMLElement, options: Options = {}): LineupEditorHandle {
  let lineup = (options.initial ? options.initial.map((s) => ({ ...s })) : cloneDefaultLineup()).slice(
    0,
    LINEUP_OUTFIELD_COUNT,
  );
  while (lineup.length < LINEUP_OUTFIELD_COUNT) {
    lineup.push(clampLineupSlot({ nx: 0.35, ny: 0.5 }));
  }

  root.innerHTML = '';
  root.classList.add('lineup-editor');

  const toolbar = document.createElement('div');
  toolbar.className = 'lineup-editor__toolbar';
  const hint = document.createElement('p');
  hint.className = 'lineup-editor__hint';
  hint.textContent = 'Arrastra a tus 10 jugadores de campo. El arquero queda fijo.';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn-outline lineup-editor__reset';
  resetBtn.textContent = 'Restablecer';
  toolbar.append(hint, resetBtn);

  const pitch = document.createElement('div');
  pitch.className = 'lineup-editor__pitch';
  pitch.setAttribute('role', 'application');
  pitch.setAttribute('aria-label', 'Editor de alineación');

  const marks = document.createElement('div');
  marks.className = 'lineup-editor__marks';
  marks.innerHTML =
    '<span class="lineup-editor__goal">Arco</span><span class="lineup-editor__mid">Medio</span>';
  pitch.append(marks);

  const chips: HTMLButtonElement[] = [];
  for (let i = 0; i < LINEUP_OUTFIELD_COUNT; i++) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lineup-editor__chip';
    chip.dataset.slot = String(i);
    chip.textContent = i === 0 ? 'Tú' : String(i + 1);
    if (i === 0) chip.classList.add('lineup-editor__chip--you');
    pitch.append(chip);
    chips.push(chip);
  }

  root.append(toolbar, pitch);

  function placeChip(i: number, slot: LineupSlot) {
    const chip = chips[i];
    // Pitch shows own half: left = defense (low nx), right = attack (high nx)
    chip.style.left = `${slot.nx * 100}%`;
    chip.style.top = `${slot.ny * 100}%`;
    chip.dataset.role = slot.role;
    chip.title = `${slot.role.toUpperCase()} · ${Math.round(slot.nx * 100)}/${Math.round(slot.ny * 100)}`;
  }

  function render() {
    for (let i = 0; i < lineup.length; i++) placeChip(i, lineup[i]);
  }

  function emit() {
    options.onChange?.(lineup.map((s) => ({ ...s })));
  }

  let dragIndex: number | null = null;

  function pointerToSlot(clientX: number, clientY: number): LineupSlot {
    const rect = pitch.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    return clampLineupSlot({ nx, ny });
  }

  function onPointerMove(event: PointerEvent) {
    if (dragIndex == null) return;
    lineup[dragIndex] = pointerToSlot(event.clientX, event.clientY);
    placeChip(dragIndex, lineup[dragIndex]);
  }

  function onPointerUp() {
    if (dragIndex == null) return;
    dragIndex = null;
    pitch.classList.remove('lineup-editor__pitch--dragging');
    emit();
  }

  for (let i = 0; i < chips.length; i++) {
    chips[i].addEventListener('pointerdown', (event) => {
      event.preventDefault();
      dragIndex = i;
      chips[i].setPointerCapture(event.pointerId);
      pitch.classList.add('lineup-editor__pitch--dragging');
    });
    chips[i].addEventListener('pointermove', onPointerMove);
    chips[i].addEventListener('pointerup', onPointerUp);
    chips[i].addEventListener('pointercancel', onPointerUp);
  }

  resetBtn.addEventListener('click', () => {
    lineup = cloneDefaultLineup();
    render();
    emit();
  });

  render();

  return {
    getLineup: () => lineup.map((s) => ({ ...s })),
    setLineup: (next) => {
      const normalized = next.slice(0, LINEUP_OUTFIELD_COUNT).map((s) => clampLineupSlot(s));
      while (normalized.length < LINEUP_OUTFIELD_COUNT) {
        normalized.push(clampLineupSlot({ nx: 0.35, ny: 0.5 }));
      }
      lineup = normalized;
      render();
    },
    reset: () => {
      lineup = cloneDefaultLineup();
      render();
      emit();
    },
    destroy: () => {
      root.innerHTML = '';
      root.classList.remove('lineup-editor');
    },
  };
}
