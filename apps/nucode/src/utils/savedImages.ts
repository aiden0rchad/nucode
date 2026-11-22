// A thread read from disk can hold hundreds of megabytes of screenshots. The backend sends a
// content-addressed reference for each instead of its bytes; the window loads the bytes when
// the image comes on screen. The reference travels as the image's source, with its type after "#".
const PREFIX = "blob:sha256:";

export function savedImageSource(data: string, mimeType: string) {
  return data.startsWith(PREFIX) ? `${data}#${mimeType}` : `data:${mimeType};base64,${data}`;
}

export function parseSavedImageSource(src: string) {
  if (!src.startsWith(PREFIX)) return null;
  const [reference, mimeType = ""] = src.split("#");
  return { reference, mimeType };
}
