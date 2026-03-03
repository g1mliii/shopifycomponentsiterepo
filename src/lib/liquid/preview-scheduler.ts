export type SchedulerFrameRequest = (callback: () => void) => () => void;

const PREVIEW_ABORT_ERROR_NAME = "AbortError";

function defaultFrameRequest(callback: () => void): () => void {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const id = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(id);
  }

  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("name" in error && typeof error.name === "string") {
    return error.name === PREVIEW_ABORT_ERROR_NAME;
  }

  return false;
}

export interface PreviewSchedulerOptions<Input, Output> {
  run: (input: Input, signal: AbortSignal) => Promise<Output>;
  onSuccess: (output: Output, input: Input, durationMs: number) => void;
  onError: (error: unknown, input: Input, durationMs: number) => void;
  requestFrame?: SchedulerFrameRequest;
  now?: () => number;
}

export class LatestPreviewScheduler<Input, Output> {
  private readonly run: (input: Input, signal: AbortSignal) => Promise<Output>;
  private readonly onSuccess: (output: Output, input: Input, durationMs: number) => void;
  private readonly onError: (error: unknown, input: Input, durationMs: number) => void;
  private readonly requestFrame: SchedulerFrameRequest;
  private readonly now: () => number;

  private pendingInput: Input | undefined;
  private hasPendingInput = false;
  private inFlightAbortController: AbortController | null = null;
  private isRunning = false;
  private scheduledCancel: (() => void) | null = null;
  private disposed = false;

  constructor(options: PreviewSchedulerOptions<Input, Output>) {
    this.run = options.run;
    this.onSuccess = options.onSuccess;
    this.onError = options.onError;
    this.requestFrame = options.requestFrame ?? defaultFrameRequest;
    this.now = options.now ?? Date.now;
  }

  enqueue(input: Input): void {
    if (this.disposed) {
      return;
    }

    this.pendingInput = input;
    this.hasPendingInput = true;
    this.inFlightAbortController?.abort();
    this.ensureScheduled();
  }

  dispose(): void {
    this.disposed = true;
    this.pendingInput = undefined;
    this.hasPendingInput = false;
    this.inFlightAbortController?.abort();
    this.inFlightAbortController = null;

    if (this.scheduledCancel) {
      this.scheduledCancel();
      this.scheduledCancel = null;
    }
  }

  private ensureScheduled(): void {
    if (this.scheduledCancel || this.isRunning || this.disposed) {
      return;
    }

    this.scheduledCancel = this.requestFrame(() => {
      this.scheduledCancel = null;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.isRunning || !this.hasPendingInput) {
      return;
    }

    const input = this.pendingInput as Input;
    this.pendingInput = undefined;
    this.hasPendingInput = false;
    this.isRunning = true;

    const abortController = new AbortController();
    this.inFlightAbortController = abortController;
    const startedAt = this.now();

    try {
      const output = await this.run(input, abortController.signal);
      if (!this.disposed && !abortController.signal.aborted) {
        this.onSuccess(output, input, this.now() - startedAt);
      }
    } catch (error) {
      if (!this.disposed && !isAbortError(error)) {
        this.onError(error, input, this.now() - startedAt);
      }
    } finally {
      if (this.inFlightAbortController === abortController) {
        this.inFlightAbortController = null;
      }

      this.isRunning = false;
      if (!this.disposed && this.hasPendingInput) {
        this.ensureScheduled();
      }
    }
  }
}
