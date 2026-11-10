import { useEffect, useRef, useMemo, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

type PlanReadyFollowupMessageProps = {
  onAccept: () => void;
  onSubmitChanges: (changes: string) => void;
  /** The plan being approved, so the decision is made with the steps in view. */
  planText?: string;
};

export function PlanReadyFollowupMessage({
  onAccept,
  onSubmitChanges,
  planText,
}: PlanReadyFollowupMessageProps) {
  // Markdown checklist items ("- [x] step") render as status icons, never as literal brackets.
  const steps = (planText ?? "").split("\n").map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).filter(Boolean)
    .map(line => { const box = /^\[( |x|X)\]\s*/.exec(line); return { text: box ? line.slice(box[0].length) : line, done: box ? box[1] !== " " : null }; });
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { card.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  const [changes, setChanges] = useState("");
  // The change request field opens on demand, so the main composer is the only input by default.
  const [editing, setEditing] = useState(false);
  const notes = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) notes.current?.focus(); }, [editing]);
  const trimmed = useMemo(() => changes.trim(), [changes]);

  return (
    <div ref={card} className="message request-user-input-message">
      <div
        className="bubble request-user-input-card"
        role="group"
        aria-label="Plan ready"
      >
        <div className="request-user-input-header">
          <div className="request-user-input-title">Plan ready</div>
        </div>
        <div className="request-user-input-body">
          {steps.length > 0 && <ol className="plan-ready-steps" aria-label="Plan steps">
            {steps.slice(0, 5).map((step, index) => <li key={index} className={step.done === null ? undefined : step.done ? "is-done" : "is-todo"}>{step.done !== null && (step.done ? <CheckCircle2 size={14} aria-label="Done" /> : <Circle size={14} aria-label="To do" />)}<span>{step.text}</span></li>)}
            {steps.length > 5 && <li className="plan-ready-more">{steps.length - 5} more {steps.length - 5 === 1 ? "step" : "steps"} in the plan above</li>}
          </ol>}
          <section className="request-user-input-question">
            <div className="request-user-input-question-text">
              {editing ? "Describe what should change, then send it back for a revised plan." : "Start building from this plan, or ask for changes first."}
            </div>
            {editing && <textarea writingsuggestions="false" aria-label="Plan changes" ref={notes}
              className="request-user-input-notes"
              placeholder="Describe what you want to change in the plan..."
              value={changes}
              onChange={(event) => setChanges(event.target.value)}
              rows={3}
            />}
          </section>
        </div>
        <div className="request-user-input-actions">
          {!editing ? <button type="button" className="plan-ready-followup-change" onClick={() => setEditing(true)}>
            Request changes
          </button> : <button
            type="button"
            className="plan-ready-followup-change"
            onClick={() => {
              if (!trimmed) {
                return;
              }
              onSubmitChanges(trimmed);
              setChanges("");
            }}
            disabled={!trimmed}
          >
            Send changes
          </button>}
          <button type="button" className="primary" onClick={onAccept}>
            Implement this plan
          </button>
        </div>
      </div>
    </div>
  );
}
