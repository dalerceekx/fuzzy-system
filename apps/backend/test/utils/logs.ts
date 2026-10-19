import {
  getLogDestination,
  setLogDestination,
} from '../../src/logging/log-destination.js';

export interface CapturedLogs {
  /** Raw JSON lines written since capture started. */
  lines(): string[];
  /** Parsed lines. */
  json(): Array<Record<string, unknown>>;
  /** The whole capture as one string (for "never contains" assertions). */
  text(): string;
  stop(): void;
}

/**
 * Captures application log lines (the app writes through a destination
 * proxy, so this works before or after the app is created).
 */
export function captureLogs(): CapturedLogs {
  const previous = getLogDestination();
  const chunks: string[] = [];
  setLogDestination({ write: (line: string) => void chunks.push(line) });
  const lines = () =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line.trim() !== '');
  return {
    lines,
    json: () =>
      lines().map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => chunks.join(''),
    stop: () => setLogDestination(previous),
  };
}

/** Waits for pino-http's `finish` listeners to run. */
export function flushLogs(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
