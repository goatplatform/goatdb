import type { ReactNode } from 'react';
import clsx from 'clsx';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useCodeBlockContext } from '@docusaurus/theme-common/internal';
import CopyButton from '@theme/CodeBlock/Buttons/CopyButton';
import WordWrapButton from '@theme/CodeBlock/Buttons/WordWrapButton';
import type { Props } from '@theme/CodeBlock/Buttons';
import styles from './styles.module.css';

// Swizzled from Docusaurus 3.10.2. Titled blocks move the copy affordance to
// the title row (Layout), so the content group keeps only WordWrap; untitled
// blocks keep the upstream layout (WordWrap + CopyButton) unchanged.
export default function CodeBlockButtons({ className }: Props): ReactNode {
  const { metadata } = useCodeBlockContext();
  return (
    <BrowserOnly>
      {() => (
        <div className={clsx(className, styles.buttonGroup)}>
          <WordWrapButton />
          {!metadata.title && <CopyButton />}
        </div>
      )}
    </BrowserOnly>
  );
}
