import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { getRuntime } from '../base/runtime/index.ts';

async function runDenoCommand(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: getRuntime().getCWD(),
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

export function setupCliEntrypointDenoTests(): void {
  TEST(
    'CLI-Entrypoints',
    'init runCLI exits 0 for help and 1 for invalid commands',
    async () => {
      const help = await runDenoCommand([
        'eval',
        "import { runCLI } from './cli/init.ts'; await runCLI(['--help']);",
      ]);
      assertEquals(help.code, 0, 'init help must exit 0');
      assertTrue(help.stdout.includes('Usage:'), 'init help must print usage');

      const invalid = await runDenoCommand([
        'eval',
        "import { runCLI } from './cli/init.ts'; await runCLI(['nope']);",
      ]);
      assertEquals(invalid.code, 1, 'invalid init command must exit 1');
      assertTrue(
        invalid.stderr.includes('Usage:'),
        'invalid init command must print usage to stderr',
      );
    },
  );

  TEST(
    'CLI-Entrypoints',
    'link CLI exits 1 with usage errors for missing commands and paths',
    async () => {
      const missingCommand = await runDenoCommand(['run', '-A', 'cli/link.ts']);
      assertEquals(missingCommand.code, 1, 'link with no command must exit 1');
      assertTrue(
        missingCommand.stderr.includes(
          'Usage: unlink or link <local-goatdb-path>',
        ),
        'link with no command must print usage',
      );

      const missingPath = await runDenoCommand([
        'run',
        '-A',
        'cli/link.ts',
        'link',
      ]);
      assertEquals(
        missingPath.code,
        1,
        'link without a local path must exit 1',
      );
      assertTrue(
        missingPath.stderr.includes('Usage: link <local-goatdb-path>'),
        'link without a local path must print usage',
      );
    },
  );
}
