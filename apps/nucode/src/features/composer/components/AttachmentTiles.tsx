import { useState } from "react";
import { IconButton } from "@/features/design-system/components/IconButton";
import Image from "lucide-react/dist/esm/icons/image";
import X from "lucide-react/dist/esm/icons/x";

export type AttachmentTile = {
  key: string;
  name: string;
  /** Preview image. When missing or broken, the tile falls back to an icon and the name. */
  src?: string;
  /** Icon shown instead of the generic image icon when there is no preview (non-image files). */
  iconSrc?: string;
  title?: string;
};

type AttachmentTilesProps = {
  items: AttachmentTile[];
  disabled: boolean;
  onRemove?: (key: string) => void;
};

function Tile({
  item,
  disabled,
  onRemove,
}: {
  item: AttachmentTile;
  disabled: boolean;
  onRemove?: (key: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const showPreview = Boolean(item.src) && !failed;
  return (
    <li className="composer-attachment" title={item.title ?? item.name}>
      {showPreview ? (
        <img
          className="composer-attachment-image"
          src={item.src}
          alt={item.name}
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="composer-attachment-fallback">
          {item.iconSrc ? (
            <img src={item.iconSrc} alt="" draggable={false} />
          ) : (
            <Image size={20} aria-hidden />
          )}
          <span className="composer-attachment-name">{item.name}</span>
        </span>
      )}
      <IconButton
        type="button"
        className="composer-attachment-remove"
        onClick={() => onRemove?.(item.key)}
        aria-label={`Remove ${item.name}`}
        disabled={disabled}
      >
        <X size={12} aria-hidden />
      </IconButton>
    </li>
  );
}

export function AttachmentTiles({ items, disabled, onRemove }: AttachmentTilesProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="composer-attachments">
      {items.map((item) => (
        <Tile key={item.key} item={item} disabled={disabled} onRemove={onRemove} />
      ))}
    </ul>
  );
}
