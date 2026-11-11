import React, { useEffect } from 'react';
import {
  AccessibilityInfo,
  Platform,
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

export interface AlertProps extends ViewProps, VariantProps<typeof alertVariants> {
  /**
   * Speak the alert when it appears, for alerts shown in response to an action such as a
   * failed submit. Android and the web already read it through the live region; iOS has
   * none, so this announces its text once. Leave it off for alerts that are part of a
   * screen's content, or every visit would read them aloud.
   */
  announce?: boolean;
}

/** The visible text of an alert's children, for the iOS announcement. */
function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join('. ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return textOf(node.props.children);
  return '';
}

const Alert: ForwardRefComponent<ViewInstance, AlertProps> = React.forwardRef(
  ({ className, variant, style, announce = false, children, ...props }, ref) => {
    const visual = useVisualTokens();

    useEffect(() => {
      if (!announce || Platform.OS !== 'ios') return;
      const message = textOf(children);
      if (message) AccessibilityInfo.announceForAccessibility(message);
      // Once, when the alert appears; a re-render must not repeat it.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once per alert, by design
    }, []);

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
      >
        {children}
      </View>
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
