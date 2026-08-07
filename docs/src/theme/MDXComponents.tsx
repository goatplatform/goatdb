import type { ReactNode } from 'react';
import MDXComponents from '@theme-original/MDXComponents';
import { useAnchorTargetClassName } from '@docusaurus/theme-common';
import useBrokenLinks from '@docusaurus/useBrokenLinks';

function Anchor({ id }: { id: string }): ReactNode {
  useBrokenLinks().collectAnchor(id);
  const className = useAnchorTargetClassName(id);
  return <a id={id} className={className} />;
}

export default {
  ...MDXComponents,
  Anchor,
};
