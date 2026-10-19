import type { DestinationStream } from 'pino';

let target: DestinationStream | null = null;

/**
 * Redirects all JSON log lines (null = back to stdout). nestjs-pino keeps a
 * single process-wide logger, so the logger always writes through this
 * proxy and the destination can be switched at any time (tests capture logs
 * with it).
 */
export function setLogDestination(stream: DestinationStream | null): void {
  target = stream;
}

export function getLogDestination(): DestinationStream | null {
  return target;
}

export const logDestination: DestinationStream = {
  write(line: string): void {
    if (target) target.write(line);
    else process.stdout.write(line);
  },
};
