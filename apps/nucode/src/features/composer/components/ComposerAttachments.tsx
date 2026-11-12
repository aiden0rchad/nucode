import { convertFileSrc } from "@tauri-apps/api/core";
import { AttachmentTiles } from "./AttachmentTiles";

type ComposerAttachmentsProps = {
  attachments: string[];
  disabled: boolean;
  onRemoveAttachment?: (path: string) => void;
};

function fileTitle(path: string) {
  if (path.startsWith("data:")) {
    return "Pasted image";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return "Image";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function attachmentPreviewSrc(path: string) {
  if (path.startsWith("data:")) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

export function ComposerAttachments({
  attachments,
  disabled,
  onRemoveAttachment,
}: ComposerAttachmentsProps) {
  return (
    <AttachmentTiles
      disabled={disabled}
      onRemove={onRemoveAttachment}
      items={attachments.map((path) => ({
        key: path,
        name: fileTitle(path),
        src: attachmentPreviewSrc(path),
        title: path.startsWith("data:") ? "Pasted image" : fileTitle(path),
      }))}
    />
  );
}
