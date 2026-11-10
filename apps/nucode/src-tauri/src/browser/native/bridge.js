// Evaluated only in WKContentWorld("nucode.browser.private"), never the page world.
(() => {
  if (globalThis.__nuBrowser) return;
  const refs = new WeakMap();
  let nodes = new Map(), next = 0, userInput = false, agentPointer = null, agentPressed = false;
  for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(event, e => {
      if (!e.isTrusted) return;
      // The agent cursor's own press arrives as a trusted event at the point it asked for; that is not the user taking over.
      if (e.type === "pointerdown" && agentPointer && performance.now() < agentPointer.until && Math.hypot(e.clientX - agentPointer.x, e.clientY - agentPointer.y) < 4) {
        agentPointer = null; agentPressed = true; return;
      }
      userInput = true;
    }, { capture: true, passive: true });
  }
  // A visible, unobstructed point inside el for the agent cursor to press, or null when something covers it.
  // Controls whose real press opens native AppKit UI (popup menu, picker, file panel) that runs a modal loop and
  // stalls the app until someone dismisses it; these keep the synthetic click.
  const nativeUi = n => n instanceof Element && (!!n.closest("select") || (n instanceof HTMLInputElement && /^(file|color|date|datetime-local|month|week|time)$/.test(n.type)) || (n instanceof HTMLLabelElement && nativeUi(n.control)));
  function point(el) {
    if (nativeUi(el)) return { x: null };
    const box = el.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const jitter = () => 0.5 + (Math.random() - 0.5) * 0.3;
    for (const r of el.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      for (const [fx, fy] of [[jitter(), jitter()], [0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
        const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        let hit = document.elementFromPoint(x, y);
        while (hit?.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
        if (hit && !nativeUi(hit) && (el.contains(hit) || (hit instanceof HTMLLabelElement && hit.control === el))) {
          agentPointer = { x, y, until: performance.now() + 5000 }; agentPressed = false;
          return { x, y, w: innerWidth };
        }
      }
    }
    return { x: null };
  }
  const hint = "Try the Headless Chromium backend (Settings → Browser)";
  const role = el => el.getAttribute("role") || ({ A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", FORM: "form", H1: "heading", H2: "heading", H3: "heading" }[el.tagName]) || (el.tagName === "INPUT" ? ({ checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button" }[el.type] || "textbox") : el.isContentEditable ? "textbox" : "generic");
  const SNAPSHOT = 'a[href],button,input,textarea,select,[role],[contenteditable="true"],nav,main,header,footer,form,h1,h2,h3';
  // Landmarks and groups are named by their label only; their text shows up as text lines and leaf names instead.
  const CONTAINER = new Set("main navigation banner contentinfo form region complementary tabpanel dialog alertdialog presentation none group list listitem listbox table grid treegrid row rowgroup document article application feed log status alert tablist menu menubar toolbar tree radiogroup generic search figure note marquee timer directory section".split(" "));
  const label = el => (el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim() || [...(el.labels || [])].map(l => l.textContent).join(" ") || el.getAttribute("alt") || el.getAttribute("placeholder") || "").trim();
  // Text nodes joined with spaces, so "Due<b>Monday</b>" reads as two words (textContent would glue them).
  const words = el => { let s = ""; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t && s.length < 1000; t = w.nextNode()) if (!/^(SCRIPT|STYLE)$/.test(t.parentElement?.tagName)) s += " " + t.data; return s; };
  const name = (el, r) => (label(el) || (CONTAINER.has(r) ? "" : words(el))).trim().slice(0, 1000);
  const collapse = s => s.split(/\s+/).filter(Boolean).join(" ");
  // Interactive elements and landmarks in document order, interleaved with the page's visible text that isn't already
  // an element's name: paragraphs, labels, due dates, table rows (cells joined with "|").
  function outline() {
    const display = new Map(), leafy = new Map();
    const disp = el => { let d = display.get(el); if (d === undefined) display.set(el, d = getComputedStyle(el).display); return d; };
    const isLeaf = el => { let v = leafy.get(el); if (v === undefined) leafy.set(el, v = el.matches(SNAPSHOT) && !CONTAINER.has(role(el))); return v; };
    // A short table cell keeps its block-level children (a score <div>, a status pill) on the row's line; a long one
    // (a layout table holding paragraphs) keeps them as separate lines so none is cut by the item length cap.
    const cells = new Map(), shown = new Map();
    const shows = el => { let v = shown.get(el); if (v === undefined) shown.set(el, v = el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0); return v; };
    const shortCell = el => { const td = el.closest("td,th"); if (!td) return null; let v = cells.get(td); if (v === undefined) cells.set(td, v = td.textContent.replace(/\s+/g, "").length <= 300 ? td : null); return v; };
    const root = document.body || document.documentElement, top = root.parentElement;
    // Skip hidden subtrees and SVG internals (an <svg role="img"> itself still counts).
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && (n.hidden || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName) || n.ownerSVGElement || n.getAttribute("aria-hidden") === "true" || n.hasAttribute("inert")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const out = [], blocks = new Map();
    for (let n = walker.nextNode(); n && out.length < 4000; n = walker.nextNode()) {
      if (n.nodeType === 1) { if (n.matches(SNAPSHOT) && n.getClientRects().length) out.push({ el: n }); continue; }
      if (!/\S/.test(n.data)) continue;
      let leaf = null, block = null, cell = null, hidden = false;
      for (let a = n.parentElement; a && a !== top; a = a.parentElement) {
        const d = disp(a);
        if (d === "none") { hidden = true; break; }
        if (!leaf && isLeaf(a)) leaf = a;
        if (!d.startsWith("inline") && d !== "contents") { block = a; break; }
      }
      if (hidden || !block) continue;
      if (block.tagName === "TD" || block.tagName === "TH") { cell = block; block = block.closest("tr") || block; }
      else if ((cell = shortCell(block))) {
        // Judge the inner block as if it stood alone: a hidden tooltip, a screen-reader-only button or a button's label
        // stays off the row (element lines name those); a link's text stays, like a title link sitting in the cell.
        let skip = !shows(block) || (leaf && leaf.tagName !== "A");
        for (let a = block; !skip && a !== cell; a = a.parentElement) skip = isLeaf(a);
        if (skip) continue;
        block = cell.closest("tr") || cell;
      }
      let entry = blocks.get(block);
      if (entry === undefined) {
        let inLeaf = false;
        for (let a = block; a && a !== top; a = a.parentElement) if (isLeaf(a)) { inLeaf = true; break; }
        entry = inLeaf || !shows(block) ? null : { parts: [], own: false, cell: null };
        blocks.set(block, entry); if (entry) out.push(entry);
      }
      if (!entry) continue;
      if (cell && entry.cell && cell !== entry.cell) entry.parts.push("|");
      entry.cell = cell; entry.parts.push(n.data);
      // Text made only of element names (a lone link in its own block) would just repeat that element.
      if (!leaf) entry.own = true;
    }
    return out;
  }
  const target = ref => {
    if (typeof ref !== "string" || !ref.trim()) throw new Error("Missing target");
    let el = nodes.get(ref);
    if (!el && !/^e\d+$/.test(ref)) {
      let matches;
      try { matches = document.querySelectorAll(ref); } catch { throw new Error("Invalid selector; use a snapshot ref or unique CSS selector"); }
      if (matches.length !== 1) throw new Error(`Target selector matched ${matches.length} elements; expected one`);
      el = matches[0];
    }
    if (!el?.isConnected) throw new Error(`Stale or unknown ref ${ref}; take another snapshot`);
    return el;
  };
  const editable = el => {
    if (el.matches(":disabled") || el.closest('[inert],[aria-disabled="true"]')) throw new Error("Element is disabled");
    if (el.readOnly) throw new Error("Element is read-only");
  };
  function textField(el, text) {
    editable(el);
    if (typeof text !== "string" || text.length > 200000) throw new Error("Invalid text");
    if (!el.isContentEditable && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement && !["checkbox", "radio", "file", "button", "submit", "reset", "hidden", "image", "range", "color"].includes(el.type))) throw new Error("Expected an editable text field");
  }
  function type(el, text) {
    textField(el, text); el.focus();
    if (el.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand("insertText", false, text)) throw new Error("Text insertion failed");
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function select(el, values) {
    editable(el);
    if (!(el instanceof HTMLSelectElement) || !Array.isArray(values) || values.some(v => typeof v !== "string") || (!el.multiple && values.length !== 1)) throw new Error("Expected a select and valid values");
    const options = [...el.options].filter(o => !o.disabled && !o.parentElement.disabled);
    const selected = values.map(value => options.find(o => o.value === value) || options.find(o => o.label === value) || options.find(o => o.textContent.trim() === value));
    if (selected.some(option => !option)) throw new Error("Unknown option or option is disabled");
    for (const option of el.options) option.selected = selected.includes(option);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function press(el, key) {
    const parts = key.split("+");
    const last = parts.pop();
    key = ({ ESC: "Escape", RETURN: "Enter", SPACE: " ", ARROWDOWN: "ArrowDown", ARROWUP: "ArrowUp" })[last.toUpperCase()] || last;
    // Many widgets (some web-app dialogs among them) still read the legacy keyCode, which is 0 unless set here.
    const upper = key.length === 1 ? key.toUpperCase() : "";
    const keyCode = ({ Enter: 13, Escape: 27, Tab: 9, " ": 32, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 })[key] ?? (/^[A-Z0-9]$/.test(upper) ? upper.charCodeAt(0) : 0);
    const code = key === " " ? "Space" : /^[A-Z]$/.test(upper) ? `Key${upper}` : /^[0-9]$/.test(key) ? `Digit${key}` : key.length > 1 ? key : "";
    const opts = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, ctrlKey: parts.includes("Control"), metaKey: (parts.includes("Meta") || parts.includes("ControlOrMeta")), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift") };
    const accepted = el.dispatchEvent(new KeyboardEvent("keydown", opts));
    if (accepted && key === "Enter" && el.form) el.form.requestSubmit();
    if (accepted && key === " " && (el.tagName === "BUTTON" || ["checkbox", "radio"].includes(el.type))) el.click();
    if (accepted && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.readOnly && el.selectionStart !== null) {
      let start = el.selectionStart, end = el.selectionEnd;
      if ((opts.ctrlKey || opts.metaKey) && key.toLowerCase() === "a") el.select();
      else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) {
        const pos = key === "Home" ? 0 : key === "End" ? el.value.length : key === "ArrowLeft" ? Math.max(0, start - 1) : Math.min(el.value.length, end + 1);
        el.setSelectionRange(opts.shiftKey ? Math.min(start, pos) : pos, opts.shiftKey ? Math.max(end, pos) : pos);
      } else if (["Backspace", "Delete"].includes(key) || (key.length === 1 && !opts.metaKey && !opts.ctrlKey && !opts.altKey)) {
        if (start === end && key === "Backspace") start = Math.max(0, start - 1);
        if (start === end && key === "Delete") end = Math.min(el.value.length, end + 1);
        const text = key.length === 1 ? key : "";
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, el.value.slice(0, start) + text + el.value.slice(end));
        el.setSelectionRange(start + text.length, start + text.length);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: text ? "insertText" : "deleteContentBackward" }));
      }
    }
    if (accepted && key === "Escape") el.blur();
    if (accepted && key === "Tab") {
      const list = [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex="0"]')].filter(e => !e.disabled && e.getClientRects().length);
      list[(list.indexOf(el) + (opts.shiftKey ? -1 : 1) + list.length) % list.length]?.focus();
    }
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }
  globalThis.__nuBrowser = p => {
    try {
      if (p.expectedUrl && location.href !== p.expectedUrl) throw new Error("Page navigated before action; retry on the current page");
      let result = null;
      if (p.op === "meta") {
        result = { title: document.title, url: location.href, favicon: document.querySelector('link[rel~="icon"]')?.href || null, userInput };
        userInput = false;
      } else if (p.op === "snapshot") {
        const items = []; nodes = new Map(); let bytes = 2, truncated = false;
        const encoder = new TextEncoder();
        for (const entry of outline()) {
          let item, el = entry.el;
          if (!el) {
            if (!entry.own) continue;
            const text = collapse(entry.parts.join(" "));
            // Separators like "|" or "•" on their own say nothing.
            if (!/[\p{L}\p{N}]/u.test(text)) continue;
            item = { role: "text", name: text.slice(0, 1000) };
          } else {
            const r = role(el), title = name(el, r);
            if (!title && /^(generic|presentation|none|group|alert|status|log|row|rowgroup|listitem|separator)$/.test(r)) continue;
            const rect = el.getBoundingClientRect();
            let ref = refs.get(el); if (!ref) { ref = `e${++next}`; refs.set(el, ref); }
            item = { ref, role: r, name: title, value: (globalThis.__nuPasswords?.isSensitive(el) || el.type === "password") ? undefined : typeof el.value === "string" ? el.value.slice(0, 1000) : undefined, bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
            // A checkbox's value is "on" either way; report what the user sees instead.
            if (el.type === "checkbox" || el.type === "radio") { item.value = undefined; item.checked = el.checked; }
            else if (el.hasAttribute("aria-checked")) item.checked = el.getAttribute("aria-checked") === "true";
            if (el.tagName === "SELECT") item.value = [...el.selectedOptions].map(o => o.label).join(", ").slice(0, 1000);
            if (el.hasAttribute("aria-expanded")) item.expanded = el.getAttribute("aria-expanded") === "true";
            // Where a link goes, so the agent can open a page directly (same-site links as a path); in-page anchors say nothing.
            if (el instanceof HTMLAnchorElement && /^https?:$/.test(el.protocol) && el.href.split("#")[0] !== location.href.split("#")[0]) {
              item.url = (el.origin === location.origin ? el.pathname + el.search + el.hash : el.href).slice(0, 300);
            }
          }
          // Reserve room for the outer envelope within the 200 KB UTF-8 cap.
          bytes += encoder.encode(JSON.stringify(item)).length + 1;
          if (items.length >= 1500 || bytes > 199000) { truncated = true; break; }
          items.push(item); if (el) nodes.set(item.ref, el);
        }
        result = { nodes: items, truncated };
      } else if (p.op === "mark" || p.op === "unmark") {
        if (!/^data-nucode-evaluate-[a-f0-9-]{36}$/.test(p.marker)) throw new Error("Invalid evaluation marker");
        if (p.op === "mark") target(p.ref).setAttribute(p.marker, "");
        else document.querySelectorAll(`[${p.marker}]`).forEach(el => el.removeAttribute(p.marker));
      } else if (p.op === "fill") {
        if (!Array.isArray(p.fields) || p.fields.length > 1000) throw new Error("Invalid fields");
        const fields = p.fields.map(field => {
          const el = target(field.target ?? field.ref); editable(el);
          if (typeof field.value !== "string" || field.value.length > 200000) throw new Error("Invalid field value");
          let value = field.value;
          if (field.type === "textbox") textField(el, value);
          else if (field.type === "checkbox" || field.type === "radio") {
            if (!(el instanceof HTMLInputElement) || el.type !== field.type || !["true", "false"].includes(value) || (field.type === "radio" && value !== "true")) throw new Error("Expected a checkbox/radio and boolean value (radio must be true)");
          } else if (field.type === "combobox") {
            if (!(el instanceof HTMLSelectElement) || el.multiple) throw new Error("Expected a single select");
            const options = [...el.options].filter(o => o.label === value || o.value === value);
            if (options.length !== 1 || options[0].disabled || options[0].parentElement.disabled) throw new Error("Unknown, ambiguous or disabled option");
            value = options[0].value;
          } else if (field.type === "slider") {
            if (!(el instanceof HTMLInputElement) || el.type !== "range" || !value.trim() || !Number.isFinite(Number(value))) throw new Error("Expected a slider and numeric value");
          } else throw new Error("Unsupported field type");
          return { el, kind: field.type, value };
        });
        for (const { el, kind, value } of fields) {
          editable(el); if (!el.isConnected) throw new Error("Field was removed; take another snapshot");
          if (kind === "textbox") type(el, value);
          else if (kind === "combobox") select(el, [value]);
          else if (kind === "slider") {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
            el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (el.checked !== (value === "true")) el.click();
        }
        result = { performed: true };
      } else if (p.op === "pressed") {
        result = { pressed: agentPressed, url: location.href };
        agentPressed = false;
      } else if (p.op === "wait") {
        result = (!p.ref || nodes.get(p.ref)?.isConnected === true) && (!p.text || document.body?.innerText.includes(p.text)) && (!p.textGone || !document.body?.innerText.includes(p.textGone));
      } else {
        const el = p.ref ? target(p.ref) : document.activeElement || document.body;
        if (el.matches(":disabled") || el.closest('[inert],[aria-disabled="true"]')) throw new Error("Element is disabled");
        if (p.op === "point") return JSON.stringify({ result: point(el) });
        if (p.op === "click") {
          el.scrollIntoView({ block: "center" }); el.focus();
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0 }));
          el.click();
        } else if (p.op === "type") {
          type(el, p.text);
          if (p.submit) press(el, "Enter");
        } else if (p.op === "press") press(el, p.key);
        else if (p.op === "select") select(el, p.values);
        else if (p.op === "scroll") {
          if (p.ref && p.x == null && p.y == null) el.scrollIntoView({ block: "center" });
          else (p.ref ? el : window).scrollBy(Number(p.x) || 0, Number(p.y) || 0);
        }
        else throw new Error(`Unsupported native operation. ${hint}`);
        result = { performed: true };
        // Values and scrolling are set directly; only key events are ones a site may ignore.
        if (p.op === "press") result.note = `Synthetic input is not isTrusted. If the site ignored it, ${hint}`;
      }
      return JSON.stringify({ result });
    } catch (e) { return JSON.stringify({ error: e.message }); }
  };
})();
