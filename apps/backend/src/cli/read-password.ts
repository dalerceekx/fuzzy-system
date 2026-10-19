import type { ReadStream } from 'node:tty';

const MAX_INPUT_BYTES = 4096;

/**
 * Reads a password from stdin — never from argv or env, which leak through
 * `ps`, shell history and /proc. On a terminal the input is not echoed;
 * otherwise (pipe, `< file`, secret manager) the first line is used.
 */
export async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) return readHidden(stdin as ReadStream, prompt);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) throw new Error('stdin input is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/, 1)[0] ?? '';
}

function readHidden(stdin: ReadStream, prompt: string): Promise<string> {
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (input: string) => {
      for (const char of input) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          finish();
          return;
        }
        if (char === '\u0003') {
          finish(new Error('Bekor qilindi'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = [...value].slice(0, -1).join('');
        } else if (value.length < MAX_INPUT_BYTES) {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}
