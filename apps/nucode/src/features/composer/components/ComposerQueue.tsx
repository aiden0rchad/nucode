import { IconButton } from "@/features/design-system/components/IconButton";
import { CornerDownRight, Ellipsis } from "lucide-react";
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { QueuedMessage } from "../../../types";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../../app/hooks/useMenuController";

type ComposerQueueProps = {
  queuedMessages: QueuedMessage[];
  pausedReason?: string | null;
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
  onSteerQueued?: (id: string) => void;
};

export function ComposerQueue({
  queuedMessages,
  pausedReason = null,
  onEditQueued,
  onDeleteQueued,
  onSteerQueued,
}: ComposerQueueProps) {
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="composer-queue">
      <div className="composer-queue-title">Queued</div>
      {pausedReason ? (
        <div className="composer-queue-hint">{pausedReason}</div>
      ) : null}
      <div className="composer-queue-list">
        {queuedMessages.map((item) => {
          const steerable = Boolean(onSteerQueued) && !item.text.trimStart().startsWith("/");
          return (
          <div key={item.id} className="composer-queue-item">
            <span className="composer-queue-text">
              {item.text ||
                (item.images?.length
                  ? item.images.length === 1
                    ? "Image"
                    : "Images"
                  : "")}
              {item.images?.length
                ? ` · ${item.images.length} image${item.images.length === 1 ? "" : "s"}`
                : ""}
            </span>
            {steerable ? (
              <button
                type="button"
                className="composer-queue-steer"
                title="Send now: the agent reads it at its next step"
                aria-label="Steer: send this message now"
                onClick={() => onSteerQueued?.(item.id)}
              >
                <CornerDownRight aria-hidden /> Steer
              </button>
            ) : null}
            <QueueMenuButton
              item={item}
              onEditQueued={onEditQueued}
              onDeleteQueued={onDeleteQueued}
              onSteerQueued={steerable ? onSteerQueued : undefined}
            />
          </div>
          );
        })}
      </div>
    </div>
  );
}

type QueueMenuButtonProps = {
  item: QueuedMessage;
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
  onSteerQueued?: (id: string) => void;
};

function QueueMenuButton({ item, onEditQueued, onDeleteQueued, onSteerQueued }: QueueMenuButtonProps) {
  const menu = useMenuController();
  const handleToggleMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      menu.toggle();
    },
    [menu],
  );

  const handleEdit = useCallback(() => {
    menu.close();
    onEditQueued?.(item);
  }, [item, menu, onEditQueued]);

  const handleDelete = useCallback(() => {
    menu.close();
    onDeleteQueued?.(item.id);
  }, [item.id, menu, onDeleteQueued]);

  const handleSteer = useCallback(() => {
    menu.close();
    onSteerQueued?.(item.id);
  }, [item.id, menu, onSteerQueued]);

  return (
    <div className="composer-queue-menu-wrap" ref={menu.containerRef}>
      <IconButton
        type="button"
        className={`composer-queue-menu${menu.isOpen ? " is-open" : ""}`}
        onClick={handleToggleMenu}
        aria-label="Queue item menu"
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
      >
        <Ellipsis aria-hidden />
      </IconButton>
      {menu.isOpen && (
        <PopoverSurface className="composer-queue-item-popover" role="menu">
          {onSteerQueued ? (
            <PopoverMenuItem onClick={handleSteer}>Steer now</PopoverMenuItem>
          ) : null}
          <PopoverMenuItem onClick={handleEdit}>Edit</PopoverMenuItem>
          <PopoverMenuItem onClick={handleDelete}>Delete</PopoverMenuItem>
        </PopoverSurface>
      )}
    </div>
  );
}
