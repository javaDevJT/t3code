import type { ConfirmDialogOptions, ConfirmDialogVariant } from "@t3tools/contracts";

type ConfirmDialogChoice = "confirm" | "cancel" | "alternate";

type ConfirmDialogCopy = {
  readonly message: string;
  readonly variant: ConfirmDialogVariant;
  readonly initialFocus: ConfirmDialogOptions["initialFocus"];
  readonly alternateLabel?: string;
};

export type ConfirmDialogState =
  | { readonly status: "idle" }
  | (ConfirmDialogCopy & { readonly status: "confirming" | "closing" });

type PendingConfirmation = {
  readonly copy: ConfirmDialogCopy;
  readonly resolve: (choice: ConfirmDialogChoice) => void;
};

const idleState: ConfirmDialogState = { status: "idle" };
let state: ConfirmDialogState = idleState;
let activeConfirmation: PendingConfirmation | null = null;
let queuedConfirmations: PendingConfirmation[] = [];
const listeners = new Set<() => void>();

function publish(next: ConfirmDialogState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function cancelPendingConfirmations(): void {
  activeConfirmation?.resolve("cancel");
  for (const confirmation of queuedConfirmations) {
    confirmation.resolve("cancel");
  }
  activeConfirmation = null;
  queuedConfirmations = [];
}

export function readConfirmDialogState(): ConfirmDialogState {
  return state;
}

/**
 * Only themed hosts subscribe, so a subscriber is a mounted host. When the last
 * one leaves, pending confirmations resolve as cancelled.
 */
export function subscribeConfirmDialogHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    cancelPendingConfirmations();
    publish(idleState);
  };
}

/** Undefined means no themed host is available. */
export function requestConfirmDialog(
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> | undefined {
  return requestConfirmDialogChoice(message, options)?.then((choice) => choice === "confirm");
}

export function requestConfirmDialogChoice(
  message: string,
  options?: ConfirmDialogOptions & { readonly alternateLabel?: string },
): Promise<ConfirmDialogChoice> | undefined {
  if (listeners.size === 0) return undefined;

  const confirmation = new Promise<ConfirmDialogChoice>((resolve) => {
    const pending = {
      copy: {
        message,
        variant: options?.variant ?? "default",
        initialFocus: options?.initialFocus,
        ...(options?.alternateLabel === undefined
          ? {}
          : { alternateLabel: options.alternateLabel }),
      },
      resolve,
    } satisfies PendingConfirmation;
    if (activeConfirmation || state.status === "closing") {
      queuedConfirmations.push(pending);
      return;
    }

    activeConfirmation = pending;
    publish({ status: "confirming", ...pending.copy });
  });

  return confirmation;
}

export function isConfirmDialogActive(): boolean {
  return state.status !== "idle" || activeConfirmation !== null || queuedConfirmations.length > 0;
}

export function respondToConfirmDialog(confirmed: boolean): void {
  respondToConfirmDialogChoice(confirmed ? "confirm" : "cancel");
}

export function respondToConfirmDialogChoice(choice: ConfirmDialogChoice): void {
  if (state.status !== "confirming" || !activeConfirmation) return;
  if (choice === "alternate" && state.alternateLabel === undefined) return;

  const confirmation = activeConfirmation;
  activeConfirmation = null;
  confirmation.resolve(choice);
  publish({ status: "closing", ...confirmation.copy });
}

export function completeConfirmDialogClose(): void {
  if (state.status !== "closing") return;

  const next = queuedConfirmations.shift();
  if (!next) {
    publish(idleState);
    return;
  }

  activeConfirmation = next;
  publish({ status: "confirming", ...next.copy });
}

export function resetConfirmDialogForTests(): void {
  listeners.clear();
  cancelPendingConfirmations();
  publish(idleState);
}
