// The demo's own controls, beside the kit's. Each has the kit's shape, { el, value, disabled,
// onChange }, and its markup and classes, so mount() places them in the rail and they look the same.

let lastId = 0;

/**
 * Controls shown together, acting as one control whose value is { name: value }. Collapsible groups
 * fold away under their heading (closed at first); others are a plain block, under a heading unless
 * `label` is null. `className` adds a class.
 */
export function group(label, controls, { collapsible = false, className = '' } = {}) {
  const el = document.createElement(collapsible ? 'details' : 'div');
  el.className = `dk-control zo-group ${className}`.trim();
  if (collapsible) {
    const summary = document.createElement('summary');
    summary.textContent = label;
    el.append(summary);
  } else if (label !== null) {
    const heading = document.createElement('div');
    Object.assign(heading, { className: 'dk-control-label', id: `zo-group-${++lastId}`, textContent: label });
    el.setAttribute('role', 'group');
    el.setAttribute('aria-labelledby', heading.id);
    el.append(heading);
  }
  el.append(...Object.values(controls).map((control) => control.el));
  const read = () => Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control.value]));
  return {
    el,
    get value() { return read(); },
    set value(next) {
      for (const [name, value] of Object.entries(next)) if (name in controls) controls[name].value = value;
    },
    get disabled() { return Object.values(controls).every((control) => control.disabled); },
    set disabled(state) { for (const control of Object.values(controls)) control.disabled = state; },
    onChange(listener) {
      const offs = Object.values(controls).map((control) => control.onChange(() => listener(read())));
      return () => offs.forEach((off) => off());
    },
  };
}
