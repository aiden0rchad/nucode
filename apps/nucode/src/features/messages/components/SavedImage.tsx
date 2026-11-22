import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getThreadImage } from "@services/tauri";
import { parseSavedImageSource } from "@utils/savedImages";

/** Where the saved screenshots of the thread on screen are loaded from. */
export const SavedImageContext = createContext<{ workspaceId: string; threadId: string } | null>(null);

// A screenshot is a few megabytes of text once loaded: keep the latest few, so scrolling back is instant.
const KEPT = 6;
const loaded = new Map<string, Promise<string>>();

function loadSavedImage(workspaceId: string, threadId: string, reference: string, mimeType: string) {
  const key = `${workspaceId}/${threadId}/${reference}`;
  const known = loaded.get(key);
  if (known) {
    loaded.delete(key);
    loaded.set(key, known);
    return known;
  }
  const request = getThreadImage(workspaceId, threadId, reference, mimeType)
    .then((response) => `data:${response.result.mimeType};base64,${response.result.data}`);
  loaded.set(key, request);
  request.catch(() => loaded.delete(key));
  for (const old of [...loaded.keys()].slice(0, Math.max(0, loaded.size - KEPT))) loaded.delete(old);
  return request;
}

function useOnScreen(ref: React.RefObject<Element | null>, eager: boolean) {
  const [visible, setVisible] = useState(eager || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (visible || !element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

/** An image of a message or tool result: shown as is, or loaded from the thread once it is on screen. */
export function MessageImagePreview({ src, alt, eager = false }: { src: string; alt: string; eager?: boolean }) {
  const saved = parseSavedImageSource(src);
  const source = useContext(SavedImageContext);
  const anchor = useRef<HTMLSpanElement>(null);
  const visible = useOnScreen(anchor, eager);
  const [shown, setShown] = useState<{ key: string; src: string | null } | null>(null);
  const key = saved && source ? `${source.threadId}/${saved.reference}` : "";
  useEffect(() => {
    if (!saved || !source || !visible) return;
    let current = true;
    loadSavedImage(source.workspaceId, source.threadId, saved.reference, saved.mimeType)
      .then((data) => current && setShown({ key, src: data }), () => current && setShown({ key, src: null }));
    return () => { current = false; };
  }, [saved?.reference, saved?.mimeType, source?.workspaceId, source?.threadId, visible, key]);
  if (!saved) return <img src={src} alt={alt} loading="lazy" />;
  if (shown?.key === key && shown.src) return <img src={shown.src} alt={alt} />;
  return (
    <span ref={anchor} className="message-image-pending">{shown?.key === key ? "Image preview unavailable." : null}</span>
  );
}
