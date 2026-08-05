import type { ComponentType, SVGProps } from 'react';

export type HomepageIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export function HomepageIcon(
  { icon: IconComponent, size = 24, className }: {
    icon: HomepageIconComponent;
    size?: number;
    className?: string;
  },
) {
  return (
    <IconComponent
      aria-hidden='true'
      className={className}
      focusable='false'
      height={size}
      shapeRendering='crispEdges'
      width={size}
    />
  );
}
