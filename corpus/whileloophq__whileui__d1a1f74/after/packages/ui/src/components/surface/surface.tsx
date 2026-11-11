import React from 'react';
import { View, type ViewInstance, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';
import { useFrostedSurface, type FrostedSurfaceProps } from '../../lib/frosted-surface';
import {
  useShadowStyle,
  useSurfaceRecipe,
  type ShadowTier,
  type SurfacePaddingSize,
} from '../../lib/recipes';
import type { ForwardRefComponent } from '../../lib/ref-types';

export type SurfaceLevel = 'base' | 'raised' | 'overlay';

export interface SurfaceProps extends ViewProps, FrostedSurfaceProps {
  /** Semantic background and depth tier. */
  level?: SurfaceLevel;
  /** Token-backed interior spacing. */
  padding?: SurfacePaddingSize;
  /** Token-backed corner radius. */
  radius?: 'sm' | 'md' | 'lg' | 'xl';
  /** Draw the theme hairline border. */
  bordered?: boolean;
  /** Override the level's depth. */
  shadow?: ShadowTier;
}

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
  base: 'bg-card',
  raised: 'bg-surface-elevated',
  overlay: 'bg-popover',
};

const LEVEL_SHADOW: Record<SurfaceLevel, ShadowTier> = {
  base: 'none',
  raised: 'sm',
  overlay: 'lg',
};

const LEVEL_TINT = {
  base: 'card',
  raised: 'surfaceElevated',
  overlay: 'popover',
} as const;

const Surface: ForwardRefComponent<ViewInstance, SurfaceProps> = React.forwardRef(
  (
    {
      level = 'base',
      padding = 'default',
      radius = 'xl',
      bordered = true,
      shadow,
      frosted = false,
      blurIntensity,
      blurTintToken,
      className,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const recipe = useSurfaceRecipe({ padding, radius, bordered });
    const depth = useShadowStyle(shadow ?? LEVEL_SHADOW[level]);
    const frost = useFrostedSurface({
      frosted,
      blurIntensity,
      blurTintToken,
      defaultTintToken: LEVEL_TINT[level],
      defaultBlurPreset: 'subtle',
    });

    return (
      <View
        ref={ref}
        className={cn(
          'border-border',
          LEVEL_CLASS[level],
          frosted && 'relative overflow-hidden bg-transparent',
          className
        )}
        style={[recipe, depth, frost.surfaceStyle, style]}
        {...props}
      >
        {frost.overlay}
        {children}
      </View>
    );
  }
);

Surface.displayName = 'Surface';

export { Surface };
