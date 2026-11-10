(() => {
  if (globalThis.__nuPasswords) return;
  const tracked = new WeakSet();
  let captured = null;
  const passwordKind = el => el instanceof HTMLInputElement && (el.type === "password" || /(?:^|\s)(current-password|new-password|one-time-code)(?:\s|$)/i.test(el.autocomplete));
  const track = el => { if (passwordKind(el)) tracked.add(el); };
  const scan = root => { track(root); root.querySelectorAll?.("input").forEach(track); };
  const mutations = records => {
    for (const record of records) {
      if (record.type === "attributes") {
        if ((record.attributeName === "type" && record.oldValue?.toLowerCase() === "password") || (record.attributeName === "autocomplete" && /(?:^|\s)(current-password|new-password|one-time-code)(?:\s|$)/i.test(record.oldValue || ""))) tracked.add(record.target);
        track(record.target);
      } else record.addedNodes.forEach(scan);
    }
  };
  const observer = new MutationObserver(mutations);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["type", "autocomplete"] });
  const isSensitive = el => { mutations(observer.takeRecords()); track(el); return tracked.has(el); };
  const visible = el => el.isConnected && !el.hidden && !el.disabled && !el.readOnly && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const usernameField = password => {
    const fields = [...(password.form || document).querySelectorAll("input")].filter(el => el.form === password.form && visible(el) && !isSensitive(el) && ["text", "email", "tel"].includes(el.type));
    return fields.find(el => /(?:^|\s)(username|email)(?:\s|$)/i.test(el.autocomplete)) || fields.filter(el => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
  };
  const capture = form => {
    if (!form) return;
    const password = [...form.querySelectorAll("input")].find(el => isSensitive(el) && el.value && !/(?:^|\s)one-time-code(?:\s|$)/i.test(el.autocomplete));
    if (!password) return;
    captured = { origin: location.origin, username: usernameField(password)?.value || "", password: password.value, created: Date.now() };
    // Retain submissions across document replacement; polling remains the fallback.
    const sink = globalThis.webkit?.messageHandlers?.nucodePasswordCapture;
    if (sink) { sink.postMessage(JSON.stringify(captured)); captured = null; }
  };
  document.addEventListener("DOMContentLoaded", () => scan(document));
  for (const event of ["input", "focusin"]) document.addEventListener(event, e => { scan(document); track(e.target); }, true);
  document.addEventListener("submit", e => capture(e.target), true);
  document.addEventListener("keydown", e => { if (e.key === "Enter") capture(e.target.form); }, true);
  document.addEventListener("click", e => { const el = e.target.closest?.('button,input[type="submit"],input[type="image"]'); if (el && ["submit", "image"].includes(el.type)) capture(el.form); }, true);
  scan(document);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  globalThis.__nuPasswords = Object.freeze({
    isSensitive,
    sensitive() { scan(document); return [...document.querySelectorAll("input")].some(el => isSensitive(el) && el.isConnected && el.value !== ""); },
    takeCaptured() { const value = captured; captured = null; return value && Date.now() - value.created < 120000 ? value : null; },
    fill(username, password) {
      const field = [...document.querySelectorAll("input")].find(el => el.type === "password" && visible(el));
      if (!field) return { filled: false, username: false };
      const user = usernameField(field);
      tracked.add(field);
      for (const [el, value] of [[user, username], [field, password]]) {
        if (!el) continue;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { filled: true, username: Boolean(user) };
    },
  });
})();
