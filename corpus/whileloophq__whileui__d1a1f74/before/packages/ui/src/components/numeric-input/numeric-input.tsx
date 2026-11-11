import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { cn } from '../../lib/cn';
import { focusFieldWrapper } from '../../lib/focus-ring';
import { tv, type VariantProps } from '../../lib/tv';
import { useThemeColors } from '../../lib/theme-colors';
import { useInteractionTokens, withInteractivePressableStyle } from '../../lib/interaction-tokens';
import { useVisualTokens } from '../../lib/visual-tokens';
import { typographyStyle } from '../../lib/recipes';
import type { ForwardRefComponent } from '../../lib/ref-types';
import { webAutofillField } from '../../lib/web-autofill';
import { fieldAccessibilityProps, useFormFieldState } from '../form-field/form-field';

const numericInputVariants = tv({
  base: 'w-full flex-row items-center border-border bg-muted',
  variants: {
    variant: {
      default: 'border-border',
      error: 'border-destructive',
    },
    size: {
      default: '',
      compact: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

const numericInputTextVariants = tv({
  base: 'text-foreground',
  variants: {
    size: {
      default: '',
      compact: '',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

function toInputText(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }
  return Number.isFinite(value) ? String(value) : '';
}

function parseNumericText(text: string) {
  const normalized = text.replace(',', '.').trim();
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampValue(value: number, min?: number, max?: number) {
  let next = value;
  if (min !== undefined && next < min) {
    next = min;
  }
  if (max !== undefined && next > max) {
    next = max;
  }
  return next;
}

/** JS float math is imprecise (72.8 + 0.1 → 72.899...). Round to clean display. */
function roundToStepPrecision(value: number, step: number): number {
  const decimals = step >= 1 ? 0 : (step.toString().split('.')[1]?.length ?? 2);
  return Number(value.toFixed(decimals));
}

export interface NumericInputProps
  extends
    Omit<TextInputProps, 'value' | 'defaultValue' | 'onChangeText' | 'keyboardType'>,
    VariantProps<typeof numericInputVariants> {
  'aria-invalid'?: boolean;
  className?: string;
  inputClassName?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  value?: number | null;
  defaultValue?: number;
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  showSteppers?: boolean;
  /** Drop the field shell (border, background, radius, padding) for embedding inside another field shell like LabeledField. */
  unstyled?: boolean;
}

interface NumericInputModelOptions {
  value: number | null | undefined;
  defaultValue: number | undefined;
  min: number | undefined;
  max: number | undefined;
  step: number;
  editable: boolean;
  onValueChange: NumericInputProps['onValueChange'];
  onBlur: TextInputProps['onBlur'];
}

function useNumericInputModel({
  value,
  defaultValue,
  min,
  max,
  step,
  editable,
  onValueChange,
  onBlur,
}: NumericInputModelOptions) {
  const [internalText, setInternalText] = useState(() => toInputText(defaultValue));
  const isControlled = value !== undefined;
  const textValue = isControlled ? toInputText(value) : internalText;
  const currentValue = useMemo(() => parseNumericText(textValue), [textValue]);

  const applyNumericValue = useCallback(
    (nextValue: number | null) => {
      const clamped = nextValue === null ? null : clampValue(nextValue, min, max);
      if (!isControlled) setInternalText(toInputText(clamped));
      onValueChange?.(clamped);
    },
    [isControlled, max, min, onValueChange]
  );

  const handleTextChange = useCallback(
    (nextText: string) => {
      if (!/^-?\d*(?:[.,]\d*)?$/.test(nextText)) return;
      if (!isControlled) setInternalText(nextText);
      onValueChange?.(parseNumericText(nextText));
    },
    [isControlled, onValueChange]
  );

  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (event) => {
      const parsed = parseNumericText(textValue);
      if (parsed !== null) applyNumericValue(roundToStepPrecision(parsed, step));
      onBlur?.(event);
    },
    [applyNumericValue, onBlur, step, textValue]
  );

  const nudge = useCallback(
    (delta: -1 | 1) => {
      const baseline = currentValue ?? min ?? 0;
      applyNumericValue(roundToStepPrecision(baseline + delta * step, step));
    },
    [applyNumericValue, currentValue, min, step]
  );

  return {
    textValue,
    handleTextChange,
    handleBlur,
    nudge,
    canDecrease: editable && (min === undefined || currentValue === null || currentValue > min),
    canIncrease: editable && (max === undefined || currentValue === null || currentValue < max),
  };
}

type NumericInputSize = NonNullable<NumericInputProps['size']>;

function numericInputTextStyle(
  visual: ReturnType<typeof useVisualTokens>,
  size: NumericInputSize,
  unstyled: boolean,
  style: TextInputProps['style']
) {
  const base = {
    ...typographyStyle(visual, size === 'compact' ? 'caption' : 'label'),
    paddingVertical: size === 'compact' ? visual.controlPaddingYSm : visual.controlPaddingYDefault,
    paddingHorizontal: unstyled ? 0 : visual.controlPaddingXDefault,
  };
  return Platform.OS === 'web'
    ? [{ ...base, width: '100%' as const, minWidth: 0 }, style]
    : [base, style];
}

function NumericAffix({
  side,
  visual,
  children,
}: {
  side: 'prefix' | 'suffix';
  visual: ReturnType<typeof useVisualTokens>;
  children: React.ReactNode;
}) {
  if (!children) return null;
  const spacing = Math.max(8, Math.round(visual.controlPaddingXDefault * 0.5));
  return (
    <View style={side === 'prefix' ? { paddingRight: spacing } : { paddingLeft: spacing }}>
      {children}
    </View>
  );
}

interface NumericStepperButtonProps {
  delta: -1 | 1;
  enabled: boolean;
  label: string;
  symbol: string;
  size: number;
  radius: number;
  model: ReturnType<typeof useNumericInputModel>;
  interaction: ReturnType<typeof useInteractionTokens>;
  visual: ReturnType<typeof useVisualTokens>;
}

function NumericStepperButton({
  delta,
  enabled,
  label,
  symbol,
  size,
  radius,
  model,
  interaction,
  visual,
}: NumericStepperButtonProps) {
  const feedbackStyle = withInteractivePressableStyle(undefined, interaction, {
    disabled: !enabled,
    disabledVariant: 'subtle',
    pressedVariant: 'default',
  });
  return (
    <Pressable
      className="shrink-0 items-center justify-center bg-secondary"
      style={(state) => {
        const baseStyle =
          typeof feedbackStyle === 'function' ? feedbackStyle(state) : feedbackStyle;
        return [baseStyle, { width: size, height: size, borderRadius: radius }];
      }}
      onPress={() => model.nudge(delta)}
      disabled={!enabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text className="font-medium text-foreground" style={typographyStyle(visual, 'body')}>
        {symbol}
      </Text>
    </Pressable>
  );
}

function NumericSteppers({
  visible,
  inset,
  size,
  radius,
  model,
  interaction,
  visual,
}: {
  visible: boolean;
  inset: number;
  size: number;
  radius: number;
  model: ReturnType<typeof useNumericInputModel>;
  interaction: ReturnType<typeof useInteractionTokens>;
  visual: ReturnType<typeof useVisualTokens>;
}) {
  if (!visible) return null;
  return (
    <View
      className="shrink-0 flex-row items-center"
      style={{ gap: inset, paddingLeft: Math.max(6, inset) }}
    >
      <NumericStepperButton
        delta={-1}
        enabled={model.canDecrease}
        label="Decrease value"
        symbol="−"
        size={size}
        radius={radius}
        model={model}
        interaction={interaction}
        visual={visual}
      />
      <NumericStepperButton
        delta={1}
        enabled={model.canIncrease}
        label="Increase value"
        symbol="+"
        size={size}
        radius={radius}
        model={model}
        interaction={interaction}
        visual={visual}
      />
    </View>
  );
}

const NumericInput: ForwardRefComponent<TextInputInstance, NumericInputProps> = React.forwardRef(
  (
    {
      className,
      inputClassName,
      prefix,
      suffix,
      value,
      defaultValue,
      onValueChange,
      min,
      max,
      step = 1,
      showSteppers = false,
      unstyled = false,
      variant,
      size = 'default',
      editable,
      'aria-invalid': ariaInvalid,
      placeholderTextColor,
      onFocus,
      onBlur,
      style: styleProp,
      ...props
    },
    ref
  ) => {
    const colors = useThemeColors();
    const interaction = useInteractionTokens();
    const visual = useVisualTokens();
    const field = useFormFieldState();
    const effectiveEditable = editable ?? !field.disabled;
    const effectiveVariant = variant ?? (field.invalid ? 'error' : 'default');
    // The border is on the wrapper and the focus on the field inside it.
    const [focused, setFocused] = useState(false);
    const model = useNumericInputModel({
      value,
      defaultValue,
      min,
      max,
      step,
      editable: effectiveEditable,
      onValueChange,
      onBlur,
    });
    const controlHeight = size === 'compact' ? visual.controlHeightSm : visual.controlHeightDefault;
    // Steppers render as inset soft buttons, centered inside the field shell.
    const stepInset = Math.max(3, Math.round(controlHeight * 0.1));
    const stepSize = controlHeight - stepInset * 2;
    const stepRadius = Math.max(3, Math.min(visual.radiusMd, Math.round(stepSize / 3)));

    return (
      <View
        className={cn(
          numericInputVariants({ variant: effectiveVariant, size }),
          unstyled && 'bg-transparent',
          focused && !unstyled && focusFieldWrapper,
          className
        )}
        style={[
          {
            // Definite height (not minHeight) so inner elements can center reliably.
            height: controlHeight,
            borderWidth: unstyled ? 0 : visual.borderWidthControl,
            borderRadius: unstyled ? 0 : visual.radiusLg,
            paddingLeft: !unstyled && prefix ? visual.controlPaddingXDefault : 0,
            paddingRight: unstyled ? 0 : showSteppers ? stepInset : 0,
          },
          !effectiveEditable ? { opacity: interaction.disabledOpacity } : undefined,
        ]}
      >
        <NumericAffix side="prefix" visual={visual}>
          {prefix}
        </NumericAffix>
        <View
          className="min-w-0 flex-1"
          style={Platform.OS === 'web' ? { minWidth: 0, flex: 1 } : undefined}
        >
          <TextInput
            ref={ref}
            {...fieldAccessibilityProps(field, props)}
            className={cn(
              numericInputTextVariants({ size }),
              'w-full web:outline-none',
              !unstyled && webAutofillField,
              inputClassName
            )}
            style={numericInputTextStyle(visual, size, unstyled, styleProp)}
            value={model.textValue}
            onChangeText={model.handleTextChange}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              model.handleBlur(event);
            }}
            keyboardType="decimal-pad"
            editable={effectiveEditable}
            aria-invalid={ariaInvalid ?? field.invalid}
            placeholderTextColor={placeholderTextColor ?? colors.placeholder}
            {...props}
          />
        </View>
        <NumericAffix side="suffix" visual={visual}>
          {suffix}
        </NumericAffix>
        <NumericSteppers
          visible={showSteppers}
          inset={stepInset}
          size={stepSize}
          radius={stepRadius}
          model={model}
          interaction={interaction}
          visual={visual}
        />
      </View>
    );
  }
);

NumericInput.displayName = 'NumericInput';

export { NumericInput, numericInputVariants, numericInputTextVariants };
