import { File, FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, Presentation } from "lucide-react";

const KINDS: [RegExp, typeof File, string][] = [
  [/\.(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$/i, FileImage, "image"],
  [/\.(csv|tsv|xlsx?|numbers)$/i, FileSpreadsheet, "sheet"],
  [/\.(pptx?|key)$/i, Presentation, "slides"],
  [/\.(zip|tar|gz|tgz|7z|rar)$/i, FileArchive, "archive"],
  [/\.(html?|css|jsx?|tsx?|json|ya?ml|toml|py|rs|go|swift|sh|sql|xml)$/i, FileCode2, "code"],
  [/\.(md|markdown|txt|rtf|docx?|pdf|pages)$/i, FileText, "text"],
];

/** A line icon for a file, matching the app's icon set; its kind sets a quiet identity color (no brand badges). */
export function FileKindIcon({ path, size = 16 }: { path: string; size?: number }) {
  const [, Icon, kind] = KINDS.find(([pattern]) => pattern.test(path)) ?? [/./, File, "file"];
  return <Icon className="file-kind-icon" data-kind={kind} size={size} aria-hidden />;
}
