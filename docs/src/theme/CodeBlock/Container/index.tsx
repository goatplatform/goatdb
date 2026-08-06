import type { ElementType, MouseEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { ThemeClassNames, usePrismTheme } from '@docusaurus/theme-common';
import {
  getPrismCssVariables,
  useCodeBlockContext,
} from '@docusaurus/theme-common/internal';
import { CopyStateContext, useCopyState } from '../copyState';
import styles from './styles.module.css';

type Props = {
  as: ElementType;
  className?: string;
  children?: ReactNode;
};

// The whole tile is the pressable copy target (same interaction as the
// homepage init command), not just the copy icon. Clicking copies unless
// the user is selecting code or pressing one of the tile's own buttons.
export default function CodeBlockContainer({ as: As, ...props }: Props): ReactNode {
  const prismTheme = usePrismTheme();
  const {
    metadata: { code },
  } = useCodeBlockContext();
  const copyState = useCopyState(code);

  const handleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (window.getSelection()?.toString()) return;
    copyState.copy();
  };

  return (
    <CopyStateContext.Provider value={copyState}>
      <As
        {...props}
        onClick={handleClick}
        style={getPrismCssVariables(prismTheme)}
        className={clsx(
          props.className,
          styles.codeBlock,
          ThemeClassNames.common.codeBlock,
        )}
      />
    </CopyStateContext.Provider>
  );
}
