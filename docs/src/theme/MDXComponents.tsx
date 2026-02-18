import type {ReactNode} from 'react';
import MDXComponents from '@theme-original/MDXComponents';
import useBrokenLinks from '@docusaurus/useBrokenLinks';

function Anchor({id}: {id: string}): ReactNode {
  useBrokenLinks().collectAnchor(id);
  return <a id={id} />;
}

export default {
  ...MDXComponents,
  Anchor,
};
