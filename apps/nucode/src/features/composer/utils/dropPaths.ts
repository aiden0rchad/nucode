const imageExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".heic",
  ".heif",
];

export function isImagePath(path: string) {
  const lower = path.toLowerCase();
  return imageExtensions.some((ext) => lower.endsWith(ext));
}

/** Relative to the project folder when inside it, absolute otherwise; quoted when it has whitespace. */
export function formatDroppedPath(path: string, projectPath?: string | null) {
  let result = path;
  if (projectPath) {
    const root = projectPath.replace(/[\\/]+$/, "");
    const normalizedRoot = root.replace(/\\/g, "/");
    const normalizedPath = path.replace(/\\/g, "/");
    if (root && normalizedPath.startsWith(`${normalizedRoot}/`)) {
      result = path.slice(root.length + 1);
    }
  }
  return /\s/.test(result) ? `"${result}"` : result;
}

/** Text to insert for dropped paths: each path followed by one space. */
export function droppedPathsText(paths: string[], projectPath?: string | null) {
  return paths.map((path) => `${formatDroppedPath(path, projectPath)} `).join("");
}
