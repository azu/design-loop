// Shared PTY write function.
// The active terminal implementation registers its WebSocket here.

let writeFn: ((text: string) => void) | null = null;

export function registerPtyWrite(fn: (text: string) => void): void {
  writeFn = fn;
}

export function writeToTerminal(text: string): void {
  if (writeFn) {
    writeFn(text);
  }
}
