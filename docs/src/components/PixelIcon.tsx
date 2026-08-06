import type { ComponentType, SVGProps } from 'react';

export type PixelIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export function PixelIcon(
  { icon: IconComponent, size = 24, className }: {
    icon: PixelIconComponent;
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
