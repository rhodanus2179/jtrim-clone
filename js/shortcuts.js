export const SHORTCUTS = Object.freeze({
  "file.new": { primary: true, alt: true, key: "n", label: "Ctrl+Alt+N" },
  "file.open": { primary: true, alt: true, key: "o", label: "Ctrl+Alt+O" },
  "file.reload": { primary: true, alt: true, key: "l", label: "Ctrl+Alt+L" },
  "file.overwrite": { primary: true, key: "s", label: "Ctrl+S" },
  "file.save": { primary: true, alt: true, key: "s", label: "Ctrl+Alt+S" },
  "file.print": { primary: true, key: "p", label: "Ctrl+P" },
  "file.printPreview": { primary: true, alt: true, key: "p", label: "Ctrl+Alt+P" },
  "file.thumbnails": { primary: true, alt: true, key: "h", label: "Ctrl+Alt+H" },
  "file.batch": { primary: true, alt: true, key: "b", label: "Ctrl+Alt+B" },
  "file.slideshow": { primary: true, alt: true, key: "w", label: "Ctrl+Alt+W" },

  "edit.undo": { primary: true, key: "z", label: "Ctrl+Z" },
  "edit.redo": { primary: true, key: "y", label: "Ctrl+Y" },
  "edit.copy": { primary: true, key: "c", label: "Ctrl+C" },
  "edit.paste": { primary: true, key: "v", label: "Ctrl+V" },
  "edit.cut": { primary: true, key: "x", label: "Ctrl+X" },
  "edit.erase": { key: "delete", label: "Delete" },
  "edit.selectAll": { primary: true, key: "a", label: "Ctrl+A" },

  "view.zoomIn": { keys: ["+", "="], shift: null, label: "+" },
  "view.zoomOut": { key: "-", label: "-" },

  "image.resize": { primary: true, alt: true, key: "r", label: "Ctrl+Alt+R" },
  "image.crop": { primary: true, alt: true, key: "c", label: "Ctrl+Alt+C" },
  "image.coordinateCrop": { primary: true, alt: true, key: "u", label: "Ctrl+Alt+U" },
  "image.flipH": { primary: true, alt: true, key: "m", label: "Ctrl+Alt+M" },
  "image.flipV": { primary: true, alt: true, key: "f", label: "Ctrl+Alt+F" },
  "image.jpegLossless": { primary: true, alt: true, key: "j", label: "Ctrl+Alt+J" },
  "image.toggleInterlace": { primary: true, alt: true, key: "i", label: "Ctrl+Alt+I" },
  "color.grayscale": { primary: true, alt: true, key: "g", label: "Ctrl+Alt+G" }
});

function normalizedKey(event) {
  return String(event.key || "").toLowerCase();
}

export function shortcutMatches(event, shortcut) {
  if (!shortcut) return false;
  if (event.getModifierState?.("AltGraph")) return false;
  const primaryPressed = Boolean(event.ctrlKey || event.metaKey);
  if (primaryPressed !== Boolean(shortcut.primary)) return false;
  if (Boolean(event.altKey) !== Boolean(shortcut.alt)) return false;

  if (shortcut.shift !== null && Boolean(event.shiftKey) !== Boolean(shortcut.shift)) {
    return false;
  }

  const key = normalizedKey(event);
  if (shortcut.keys) return shortcut.keys.includes(key);
  return key === shortcut.key;
}

export function shortcutCommandForEvent(event, shortcuts = SHORTCUTS) {
  for (const [command, shortcut] of Object.entries(shortcuts)) {
    if (shortcutMatches(event, shortcut)) return command;
  }
  return null;
}

export function displayShortcutLabel(shortcut, {
  apple = typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "")
} = {}) {
  if (!shortcut) return "";
  let label = shortcut.label || "";
  if (!apple) return label;
  return label
    .replaceAll("Ctrl+", "⌘")
    .replaceAll("Alt+", "⌥")
    .replaceAll("Shift+", "⇧");
}

export function applyShortcutLabels(root = document, shortcuts = SHORTCUTS) {
  for (const [command, shortcut] of Object.entries(shortcuts)) {
    const button = root.querySelector(`[data-command="${command}"]`);
    const kbd = button?.querySelector("kbd");
    if (kbd) kbd.textContent = displayShortcutLabel(shortcut);
  }
}
