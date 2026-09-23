export type Issue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  part?: string;
  hint?: string;
};

// Thrown by every operation that fails; carries the issues to show the user.
export class OpError extends Error {
  issues: Issue[];
  constructor(message: string, issues: Issue[] = []) {
    super(message);
    this.name = "OpError";
    this.issues = issues.length ? issues : [{ severity: "error", code: "error", message }];
  }
}

export const hasErrors = (issues: Issue[]) => issues.some(i => i.severity === "error");
