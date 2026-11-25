// The release cleanup worker (src-tauri/worker) driven as the app drives it:
// one framed request on stdin and the model on fd 3. Used by the opt-in
// real-model tests (dictionaryEval, styleEval); never by default CI.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

export interface Reply { ms: number; text: string | null }

export function askWorker(worker: string, modelPath: string, prompt: string): Promise<Reply> {
  const model = openSync(modelPath, 'r');
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(worker, [], { stdio: ['pipe', 'pipe', 'ignore', model] });
    const { stdin, stdout } = child as typeof child & {
      stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream;
    };
    const chunks: Buffer[] = [];
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', () => {
      closeSync(model);
      const frame = Buffer.concat(chunks);
      if (frame.length < 4) return reject(new Error('worker sent no reply frame'));
      const reply = JSON.parse(frame.subarray(4).toString('utf8')) as
        { status: string; text?: string };
      resolve({ ms: Date.now() - started, text: reply.status === 'ok' ? reply.text ?? null : null });
    });
    const body = Buffer.from(JSON.stringify({
      modelPath: '/dev/fd/3', prompt, requestId: 'eval',
    }));
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    stdin.write(Buffer.concat([head, body]));
    stdout.once('end', () => stdin.end());
  });
}
