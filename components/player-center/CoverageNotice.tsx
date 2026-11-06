import type { ReactNode } from "react";

/** The restriction stays visible; native disclosure keeps the longer explanation keyboard accessible. */
export default function CoverageNotice({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="pc-coverage pc-expand"><summary><span>{summary}</span><span className="pc-coverage-action">Details</span></summary><div className="pc-coverage-content">{children}</div></details>;
}
