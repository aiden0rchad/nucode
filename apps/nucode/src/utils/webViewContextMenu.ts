/** The web view's own menu (Reload, AutoFill) is only useful where there is text, a link or a picture to act on. */
export function keepsNativeContextMenu(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest("input, textarea, [contenteditable]:not([contenteditable='false']), a[href], img, .xterm")) {
    return true;
  }
  return Boolean(window.getSelection()?.toString());
}

/** Runs after the app's own menus, which stop the event before it reaches the document. */
export function hideWebViewContextMenu() {
  document.addEventListener("contextmenu", (event) => {
    if (!keepsNativeContextMenu(event.target)) {
      event.preventDefault();
    }
  });
}
