import type { ReactNode } from 'react';
import clsx from 'clsx';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useCodeBlockContext } from '@docusaurus/theme-common/internal';
import Container from '@theme/CodeBlock/Container';
import Title from '@theme/CodeBlock/Title';
import Content from '@theme/CodeBlock/Content';
import Buttons from '@theme/CodeBlock/Buttons';
import CopyButton from '@theme/CodeBlock/Buttons/CopyButton';
import type { Props } from '@theme/CodeBlock/Layout';
import styles from './styles.module.css';

// Swizzled from Docusaurus 3.10.2 (upstream structure preserved: Container
// wraps a title row + content div holding Content and Buttons). Titled blocks
// surface the copy affordance in the title row (right-aligned, BrowserOnly
// like the content buttons); untitled blocks keep it in the content Buttons.
export default function CodeBlockLayout({ className }: Props): ReactNode {
  const { metadata } = useCodeBlockContext();
  return (
    <Container as='div' className={clsx(className, metadata.className)}>
      {metadata.title && (
        <div className={styles.codeBlockTitle}>
          <span className={styles.codeBlockTitleText}>
            <Title>{metadata.title}</Title>
          </span>
          <BrowserOnly>
            {() => <CopyButton className={styles.titleCopyButton} />}
          </BrowserOnly>
        </div>
      )}
      <div className={styles.codeBlockContent}>
        <Content />
        <Buttons />
      </div>
    </Container>
  );
}
