import assert from "node:assert/strict";
import {
  SHORTCUTS,
  shortcutCommandForEvent,
  shortcutMatches,
  displayShortcutLabel
} from "../js/shortcuts.js";

function keyEvent(key, {
  ctrl = false,
  meta = false,
  alt = false,
  shift = false
} = {}) {
  return {
    key,
    ctrlKey: ctrl,
    metaKey: meta,
    altKey: alt,
    shiftKey: shift
  };
}

assert.equal(shortcutCommandForEvent(keyEvent("n", { ctrl: true, alt: true })), "file.new");
assert.equal(shortcutCommandForEvent(keyEvent("o", { ctrl: true, alt: true })), "file.open");
assert.equal(shortcutCommandForEvent(keyEvent("l", { ctrl: true, alt: true })), "file.reload");
assert.equal(shortcutCommandForEvent(keyEvent("s", { ctrl: true })), "file.overwrite");
assert.equal(shortcutCommandForEvent(keyEvent("s", { ctrl: true, alt: true })), "file.save");
assert.equal(shortcutCommandForEvent(keyEvent("w", { ctrl: true, alt: true })), "file.slideshow");
assert.equal(shortcutCommandForEvent(keyEvent("c", { ctrl: true, alt: true })), "image.crop");
assert.equal(shortcutCommandForEvent(keyEvent("f", { ctrl: true, alt: true })), "image.flipV");
assert.equal(shortcutCommandForEvent(keyEvent("+", { shift: true })), "view.zoomIn");
assert.equal(shortcutCommandForEvent(keyEvent("=")), "view.zoomIn");
assert.equal(shortcutCommandForEvent(keyEvent("-")), "view.zoomOut");

// Browser-reserved legacy bindings must be left to the browser.
for (const [key, modifiers] of [
  ["n", { ctrl: true }],
  ["o", { ctrl: true }],
  ["w", { ctrl: true }],
  ["t", { ctrl: true }],
  ["u", { ctrl: true }],
  ["f", { ctrl: true }],
  ["j", { ctrl: true }],
  ["r", { ctrl: true }],
  ["g", { ctrl: true }],
  ["b", { ctrl: true }]
]) {
  assert.equal(
    shortcutCommandForEvent(keyEvent(key, modifiers)),
    null,
    `legacy browser shortcut Ctrl+${key.toUpperCase()} should not be captured`
  );
}

assert.equal(shortcutMatches(keyEvent("p", { ctrl: true }), SHORTCUTS["file.print"]), true);
assert.equal(shortcutMatches(keyEvent("p", { ctrl: true, alt: true }), SHORTCUTS["file.print"]), false);
assert.equal(displayShortcutLabel(SHORTCUTS["file.save"], { apple: false }), "Ctrl+Alt+S");
assert.equal(displayShortcutLabel(SHORTCUTS["file.save"], { apple: true }), "⌘⌥S");

console.log("Shortcut smoke tests passed");
