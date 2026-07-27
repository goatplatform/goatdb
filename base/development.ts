import { getEffectiveRuntimeId } from './runtime/index.ts';

export async function copyToClipboard(value: string): Promise<boolean> {
  if (getEffectiveRuntimeId() !== 'deno') return false;
  try {
    if (Deno.build.os === 'darwin') {
      const process = new Deno.Command('pbcopy', { stdin: 'piped' }).spawn();
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(value));
      await writer.close();
      await process.output();
      return true;
    }
    if (Deno.build.os === 'windows') {
      console.log(`Copy:\n\n${value}\n`);
      return true;
    }
  } catch (_err: unknown) {
    // Clipboard operations may fail in non-browser environments.
  }
  return false;
}
