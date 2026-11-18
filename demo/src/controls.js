// The demo's own controls, beside the kit's. Each has the kit's shape, { el, value, disabled,
// onChange }, and its markup and classes, so mount() places them in the rail and they look the same.

let lastId = 0;

/**
 * Controls shown together under a heading, acting as one control whose value is { name: value }.
 * Collapsible groups fold away (closed at first); others are a plain block.
 */
export function group(label, controls, { collapsible = false } = {}) {
  const el = document.createElement(collapsible ? 'details' : 'div');
  el.className = 'dk-control zo-group';
  const heading = document.createElement(collapsible ? 'summary' : 'div');
  heading.textContent = label;
  if (!collapsible) {
    heading.className = 'dk-control-label';
    heading.id = `zo-group-${++lastId}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-labelledby', heading.id);
  }
  el.append(heading, ...Object.values(controls).map((control) => control.el));
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

/**
 * A row of buttons, [{ name, label }]. Its value is the name of the last one pressed, and
 * enable(name, state) enables or disables one of them.
 */
export function actions(list) {
  const listeners = new Set();
  let last = null;
  const el = document.createElement('div');
  el.className = 'dk-control dk-preset-list';
  const buttons = Object.fromEntries(list.map(({ name, label }) => {
    const button = document.createElement('button');
    Object.assign(button, { type: 'button', className: 'dk-button', textContent: label });
    button.addEventListener('click', () => {
      last = name;
      for (const listener of listeners) listener(name);
    });
    el.append(button);
    return [name, button];
  }));
  return {
    el,
    get value() { return last; },
    set value(next) { last = next; },
    get disabled() { return Object.values(buttons).every((button) => button.disabled); },
    set disabled(state) { for (const button of Object.values(buttons)) button.disabled = state; },
    enable(name, state) { buttons[name].disabled = !state; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A drop-down whose options are set later, with setOptions([{ label, value, disabled }]). The first
 * option is `prompt`, with the value null, which the select returns to after each choice.
 */
export function chooser({ label, prompt }) {
  const listeners = new Set();
  const id = `zo-chooser-${++lastId}`;
  const el = document.createElement('div');
  el.className = 'dk-control dk-select';
  const labelEl = document.createElement('label');
  Object.assign(labelEl, { className: 'dk-control-label', htmlFor: id, textContent: label });
  const input = document.createElement('select');
  input.id = id;
  el.append(labelEl, input);
  let values = [null];
  const setOptions = (options) => {
    values = [null, ...options.map((option) => option.value)];
    input.replaceChildren(...[{ label: prompt }, ...options].map((option, i) => {
      const element = document.createElement('option');
      Object.assign(element, { value: String(i), textContent: option.label, disabled: Boolean(option.disabled) });
      return element;
    }));
  };
  setOptions([]);
  input.addEventListener('change', () => {
    const value = values[input.selectedIndex];
    input.selectedIndex = 0;
    if (value !== null) for (const listener of listeners) listener(value);
  });
  return {
    el,
    setOptions,
    get value() { return null; },
    set value(_) {},
    get disabled() { return input.disabled; },
    set disabled(state) {
      input.disabled = state;
      el.toggleAttribute('data-disabled', state);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
