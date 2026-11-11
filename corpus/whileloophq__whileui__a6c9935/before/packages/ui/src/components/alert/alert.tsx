import React from 'react';
import {
  View,
  Text,
  type ViewInstance,
  type ViewProps,
  type TextInstance,
  type TextProps,
} from 'react-native';
import { cn } from '../../lib/cn';
import { tv, type VariantProps } from '../../lib/tv';
import { useVisualTokens } from '../../lib/visual-tokens';
import { surfacePadding, surfaceRadius, typographyStyle } from '../../lib/recipes';
import type { ForwardRefComponent } from '../../lib/ref-types';

const alertVariants = tv({
  base: 'w-full border',
  variants: {
    variant: {
      default: 'border-border bg-background',
      destructive: 'border-destructive-soft-border bg-destructive-soft',
      success: 'border-success-soft-border bg-success-soft',
      warning: 'border-warning-soft-border bg-warning-soft',
      info: 'border-info-soft-border bg-info-soft',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface AlertProps extends ViewProps, VariantProps<typeof alertVariants> {}

const Alert: ForwardRefComponent<ViewInstance, AlertProps> = React.forwardRef(
  ({ className, variant, style, ...props }, ref) => {
    const visual = useVisualTokens();
    return (
      <View
        ref={ref}
        // A status message that appears is announced without focus moving to it. Set
        // before the spread so a decorative note can opt out.
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className={cn(alertVariants({ variant }), className)}
        style={[
          {
            borderRadius: surfaceRadius(visual, 'lg'),
            borderWidth: visual.borderWidthHairline,
            padding: surfacePadding(visual, 'sm'),
          },
          style,
        ]}
        {...props}
      />
    );
  }
);

Alert.displayName = 'Alert';

export interface AlertTitleProps extends TextProps {}

const AlertTitle: ForwardRefComponent<TextInstance, AlertTitleProps> = React.forwardRef(
  ({ className, style, ...props }, ref) => {
    const visual = useVisualTokens();
    return (
      <Text
        ref={ref}
        className={cn('mb-1 font-semibold text-foreground', className)}
        style={[typographyStyle(visual, 'body'), style]}
        {...props}
      />
    );
  }
);

AlertTitle.displayName = 'AlertTitle';

export interface AlertDescriptionProps extends TextProps {}

const AlertDescription: ForwardRefComponent<TextInstance, AlertDescriptionProps> = React.forwardRef(
  ({ className, style, ...props }, ref) => {
    const visual = useVisualTokens();
    return (
      <Text
        ref={ref}
        className={cn('text-muted-foreground', className)}
        style={[typographyStyle(visual, 'label'), style]}
        {...props}
      />
    );
  }
);

AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
