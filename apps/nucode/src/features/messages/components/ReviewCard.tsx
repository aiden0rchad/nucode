import { useRef, useState } from "react";
import { CircleCheck, ClipboardCheck } from "lucide-react";
import type { TurnReview } from "@/types";

/** The gate's own wording names internal parts; this says the same thing to the person reading the turn. */
function reason(message: string): string {
  if (/^No QA major/.test(message)) return "No QA review ran after the last change in this turn.";
  const changed = /^Artifact changed after QA: (.+)/.exec(message);
  if (changed) return `A file changed after QA reviewed it: ${changed[1]}`;
  const unreadable = /^Cannot recheck the reviewed artifact: (.+)/.exec(message);
  return unreadable ? `A reviewed file can no longer be read: ${unreadable[1]}` : message;
}

/** The follow-up that asks the team to close what a review left open. */
export function reviewFollowUp(review: TurnReview): string {
  const open = review.checks.filter(check => !check.passed);
  return open.length
    ? `Have a QA major review this again. The last review could not confirm:\n${open.map(check => `- ${check.criterion}`).join("\n")}\nFix what is really wrong first. Where a check cannot be proven from the current files and commands, replace it with one that can and say so.`
    : "Have a QA major review the result of the previous turn. No review covered its last change.";
}

/** A finished team turn's review: passed, or what QA could not confirm and one way to follow it up. */
export function ReviewCard({ review, onFollowUp, disabled = false }: { review: TurnReview; onFollowUp?: () => Promise<boolean>; disabled?: boolean }) {
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const open = review.checks.filter(check => !check.passed);
  const confirmed = review.checks.filter(check => check.passed);
  const verified = review.status === "verified";
  const title = verified ? "Review passed"
    : open.length ? `Review: ${confirmed.length} of ${review.checks.length} checks confirmed`
    : review.checks.length ? "Review is out of date" : "Not reviewed";
  const send = async () => {
    if (!onFollowUp || disabled || sending.current) return;
    sending.current = true; setPending(true);
    try { await onFollowUp(); } finally { sending.current = false; setPending(false); }
  };
  return <section className={`turn-error-card review-card${verified ? " is-verified" : ""}`} aria-label={title}>
    <div className="turn-error-heading">{verified ? <CircleCheck size={18} aria-hidden /> : <ClipboardCheck size={18} aria-hidden />}<strong>{title}</strong></div>
    {verified ? <p>QA confirmed {confirmed.length === 1 ? "the one check" : `all ${confirmed.length} checks`} with its own tool runs, and the files it reviewed have not changed since.</p>
      : open.length ? <>
        <p>The turn finished and its result stands. QA could not confirm {open.length === 1 ? "this check" : "these checks"}:</p>
        <ul className="review-open">{open.map(check => <li key={check.criterion}><strong>{check.criterion}</strong>{check.note && <span title={check.note}>{check.note}</span>}</li>)}</ul>
      </>
      : <p>The turn finished and its result stands. {reason(review.message)}</p>}
    {confirmed.length > 0 && <details><summary>{verified ? "Checks" : `${confirmed.length} confirmed`}</summary><ul>{confirmed.map(check => <li key={check.criterion}>{check.criterion}</li>)}</ul></details>}
    {!verified && onFollowUp && <div className="turn-error-actions">
      <button type="button" className="ghost" disabled={disabled || pending} onClick={() => { void send(); }}>{open.length ? "Check again with QA" : "Run a QA review"}</button>
    </div>}
  </section>;
}
