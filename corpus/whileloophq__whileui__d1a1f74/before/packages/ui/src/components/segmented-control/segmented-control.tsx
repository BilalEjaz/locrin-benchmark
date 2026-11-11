import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  type PressableProps,
  type TextProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { cn } from '../../lib/cn';
import { focusRingInset } from '../../lib/focus-ring';
import { tv } from '../../lib/tv';
import { useInteractionTokens, withInteractivePressableStyle } from '../../lib/interaction-tokens';
import { useThemeColors } from '../../lib/theme-colors';
import { useVisualTokens } from '../../lib/visual-tokens';
import { typographyStyle } from '../../lib/recipes';

const segmentedControlVariants = tv({
  base: 'w-full flex-row items-center',
  variants: {
    variant: {
      default: '',
      pill: '',
    },
    wrap: {
      true: 'flex-wrap justify-center gap-1',
      false: 'flex-nowrap gap-1',
    },
    size: {
      default: '',
      compact: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    wrap: true,
    size: 'default',
  },
});

const segmentedControlItemVariants = tv({
  base: 'min-w-0 flex-row items-center justify-center',
  variants: {
    variant: {
      default: '',
      pill: '',
    },
    selected: {
      true: '',
      false: '',
    },
    size: {
      default: '',
      compact: '',
    },
    disabled: {
      true: '',
      false: '',
    },
    wrap: {
      true: 'grow-0',
      false: 'flex-1',
    },
  },
  defaultVariants: {
    variant: 'default',
    selected: false,
    size: 'default',
    disabled: false,
    wrap: true,
  },
});

const segmentedControlItemTextVariants = tv({
  base: 'font-medium',
  variants: {
    selected: {
      true: 'text-foreground',
      false: 'text-muted-foreground',
    },
    size: {
      default: '',
      compact: '',
    },
  },
  defaultVariants: {
    selected: false,
    size: 'default',
  },
});

function getSegmentedContainerStyle(
  visual: ReturnType<typeof useVisualTokens>,
  colors: ReturnType<typeof useThemeColors>,
  variant: 'default' | 'pill'
) {
  const inset = Math.max(4, Math.round(visual.controlPaddingYSm * 0.5));
  return {
    borderRadius: variant === 'pill' ? 999 : visual.radiusXl,
    backgroundColor: colors.muted,
    padding: inset,
  };
}

function getSegmentedItemStyle(
  visual: ReturnType<typeof useVisualTokens>,
  colors: ReturnType<typeof useThemeColors>,
  size: 'default' | 'compact',
  variant: 'default' | 'pill',
  selected: boolean
) {
  const compact = size === 'compact';
  return {
    minHeight: compact ? visual.controlHeightSm : visual.controlHeightDefault,
    borderRadius: variant === 'pill' ? 999 : visual.radiusLg,
    paddingHorizontal: compact ? visual.controlPaddingXSm : visual.controlPaddingXDefault,
    paddingVertical: compact ? visual.controlPaddingYSm : visual.controlPaddingYDefault,
    borderWidth: selected ? visual.borderWidthHairline : 0,
    borderColor: selected ? colors.surfaceBorder : 'transparent',
    backgroundColor: selected ? colors.surfaceElevated : 'transparent',
  };
}

interface SegmentedControlContextValue {
  value: string;
  onValueChange: (next: string) => void;
  variant: 'default' | 'pill';
  size: 'default' | 'compact';
  wrap: boolean;
  disabled: boolean;
}

const SegmentedControlContext = createContext<SegmentedControlContextValue>({
  value: '',
  onValueChange: () => {},
  variant: 'default',
  size: 'default',
  wrap: true,
  disabled: false,
});

interface SegmentedControlItemContextValue {
  selected: boolean;
  size: 'default' | 'compact';
}

const SegmentedControlItemContext = createContext<SegmentedControlItemContextValue>({
  selected: false,
  size: 'default',
});

export interface SegmentedControlProps extends ViewProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: 'default' | 'pill';
  wrap?: boolean | 'auto';
  size?: 'default' | 'compact';
  disabled?: boolean;
  className?: string;
}

export interface SegmentedControlItemProps extends Omit<PressableProps, 'children'> {
  value: string;
  children?: React.ReactNode;
  className?: string;
}

export interface SegmentedControlItemTextProps extends TextProps {
  className?: string;
}

function SegmentedControl({
  value: controlledValue,
  defaultValue = '',
  onValueChange,
  variant = 'default',
  wrap = 'auto',
  size = 'default',
  disabled = false,
  className,
  children,
  style: styleProp,
  ...props
}: SegmentedControlProps) {
  const visual = useVisualTokens();
  const colors = useThemeColors();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const itemCount = useMemo(
    () => React.Children.toArray(children).filter((child) => React.isValidElement(child)).length,
    [children]
  );
  const shouldWrap = wrap === 'auto' ? itemCount > 3 : wrap;

  const handleValueChange = useCallback(
    (nextValue: string) => {
      if (disabled || value === nextValue) {
        return;
      }
      setInternalValue(nextValue);
      onValueChange?.(nextValue);
    },
    [disabled, onValueChange, value]
  );

  const contextValue = useMemo(
    () => ({ value, onValueChange: handleValueChange, variant, size, wrap: shouldWrap, disabled }),
    [disabled, handleValueChange, shouldWrap, size, value, variant]
  );

  return (
    <SegmentedControlContext.Provider value={contextValue}>
      <View
        className={cn(segmentedControlVariants({ variant, wrap: shouldWrap, size }), className)}
        style={[getSegmentedContainerStyle(visual, colors, variant), styleProp]}
        accessibilityRole="radiogroup"
        {...props}
      >
        {children}
      </View>
    </SegmentedControlContext.Provider>
  );
}

function SegmentedControlItem({
  value: itemValue,
  className,
  children,
  disabled: itemDisabled,
  style: styleProp,
  ...props
}: SegmentedControlItemProps) {
  const { value, onValueChange, variant, size, wrap, disabled } =
    useContext(SegmentedControlContext);
  const selected = value === itemValue;
  const finalDisabled = disabled || Boolean(itemDisabled);
  const interaction = useInteractionTokens();
  const visual = useVisualTokens();
  const colors = useThemeColors();
  const interactiveStyle = withInteractivePressableStyle(styleProp, interaction, {
    disabled: finalDisabled,
    pressedVariant: 'default',
  });
  const wrapBasisStyle: ViewStyle | undefined = wrap
    ? { flexBasis: `${visual.segmentedWrapBasisRatio * 100}%` }
    : undefined;
  const tokenStyle = getSegmentedItemStyle(visual, colors, size, variant, selected);
  const contextValue = useMemo(() => ({ selected, size }), [selected, size]);

  return (
    <SegmentedControlItemContext.Provider value={contextValue}>
      <Pressable
        className={cn(
          segmentedControlItemVariants({
            variant,
            selected,
            size,
            disabled: finalDisabled,
            wrap,
          }),
          focusRingInset,
          className
        )}
        onPress={() => onValueChange(itemValue)}
        accessibilityRole="radio"
        // A radio is checked, not selected. `selected` maps to `aria-selected`, which is
        // not a valid attribute on `role="radio"` — assistive technology could not tell
        // which segment was active. `checked` also carries the state correctly on native.
        accessibilityState={{ checked: selected, disabled: finalDisabled }}
        aria-checked={selected}
        disabled={finalDisabled}
        style={(state) => {
          const baseStyle =
            typeof interactiveStyle === 'function' ? interactiveStyle(state) : interactiveStyle;
          return [baseStyle, tokenStyle, wrapBasisStyle ?? null];
        }}
        hitSlop={4}
        {...props}
      >
        {typeof children === 'string' ? (
          <SegmentedControlItemText>{children}</SegmentedControlItemText>
        ) : (
          children
        )}
      </Pressable>
    </SegmentedControlItemContext.Provider>
  );
}

function SegmentedControlItemText({ className, style, ...props }: SegmentedControlItemTextProps) {
  const { selected, size } = useContext(SegmentedControlItemContext);
  const visual = useVisualTokens();
  const typography = typographyStyle(visual, size === 'compact' ? 'caption' : 'label');

  return (
    <Text
      className={cn(segmentedControlItemTextVariants({ selected, size }), className)}
      style={[typography, style]}
      numberOfLines={1}
      {...props}
    />
  );
}

SegmentedControl.displayName = 'SegmentedControl';
SegmentedControlItem.displayName = 'SegmentedControlItem';
SegmentedControlItemText.displayName = 'SegmentedControlItemText';

export {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
  segmentedControlVariants,
  segmentedControlItemVariants,
  segmentedControlItemTextVariants,
};
