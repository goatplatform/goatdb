import type { ReactNode } from 'react';
import clsx from 'clsx';
import { translate } from '@docusaurus/Translate';
import Button from '@theme/CodeBlock/Buttons/Button';
import { Check, CopySharp as Copy } from 'pixelarticons/react';
import { PixelIcon } from '../../../../components/PixelIcon';
import { useCopyStateContext } from '../../copyState';
import styles from './styles.module.css';

function title(): string {
  return translate({
    id: 'theme.CodeBlock.copy',
    message: 'Copy',
    description: 'The copy button label on code blocks',
  });
}

function ariaLabel(isCopied: boolean): string {
  return isCopied
    ? translate({
        id: 'theme.CodeBlock.copied',
        message: 'Copied',
        description: 'The copied button label on code blocks',
      })
    : translate({
        id: 'theme.CodeBlock.copyButtonAriaLabel',
        message: 'Copy code to clipboard',
        description: 'The ARIA label for copy code blocks button',
      });
}

// Bare pixel icon affordance for every code block (docs and generated API
// alike). Copy state lives in the swizzled Container: the whole tile is the
// copy target and this icon is the visible feedback + keyboard path.
export default function CopyButton({ className }: { className?: string }): ReactNode {
  const { isCopied, copy } = useCopyStateContext();
  return (
    <Button
      aria-label={ariaLabel(isCopied)}
      title={title()}
      className={clsx(className, styles.copyButton)}
      onClick={copy}>
      <PixelIcon icon={isCopied ? Check : Copy} size={20} />
    </Button>
  );
}
