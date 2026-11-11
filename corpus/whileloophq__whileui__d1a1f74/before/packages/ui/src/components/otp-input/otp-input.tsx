import { useEffect, useState } from 'react';
import { Platform, TextInput, View, type ViewProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Text } from '../text';
import { cn } from '../../lib/cn';
import { tv } from '../../lib/tv';
import { useThemeColors } from '../../lib/theme-colors';
import { useInteractionTokens } from '../../lib/interaction-tokens';
import { useVisualTokens } from '../../lib/visual-tokens';
import { typographyStyle } from '../../lib/recipes';

const otpCellVariants = tv({
  base: 'items-center justify-center border bg-muted',
  variants: {
    size: { default: 'w-11', compact: 'w-9' },
    state: {
      idle: 'border-border',
      focused: 'border-primary',
      error: 'border-destructive',
      errorFocused: 'border-destructive',
    },
  },
  defaultVariants: { size: 'default', state: 'idle' },
});

export interface OTPInputProps extends Omit<ViewProps, 'children'> {
  length?: number;
  value?: string;
  onValueChange?: (value: string) => void;
  onComplete?: (code: string) => void;
  variant?: 'default' | 'error';
  size?: 'default' | 'compact';
  secure?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

function OTPInput({
  length = 6,
  value: controlledValue,
  onValueChange,
  onComplete,
  variant = 'default',
  size = 'default',
  secure = false,
  disabled = false,
  autoFocus = false,
  className,
  ...props
}: OTPInputProps) {
  const [internalValue, setInternalValue] = useState('');
  const isControlled = controlledValue !== undefined;
  const val = isControlled ? controlledValue : internalValue;
  const [focused, setFocused] = useState(false);
  const colors = useThemeColors();
  const interaction = useInteractionTokens();
  const visual = useVisualTokens();

  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (variant !== 'error') return;
    const d = Math.round(interaction.motionFast / 4);
    shakeX.value = withSequence(
      withTiming(8, { duration: d, easing: Easing.linear }),
      withTiming(-8, { duration: d, easing: Easing.linear }),
      withTiming(6, { duration: d, easing: Easing.linear }),
      withTiming(-6, { duration: d, easing: Easing.linear }),
      withTiming(0, { duration: d, easing: Easing.linear })
    );
  }, [variant, shakeX, interaction.motionFast]);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const update = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, length);
    if (!isControlled) setInternalValue(cleaned);
    onValueChange?.(cleaned);
    if (cleaned.length === length) onComplete?.(cleaned);
  };

  const isError = variant === 'error';
  const cursorAt = focused ? Math.min(val.length, length - 1) : -1;

  return (
    <View
      className={cn(className)}
      style={disabled ? { opacity: interaction.disabledOpacity } : undefined}
      {...props}
    >
      <Animated.View style={shakeStyle} className="flex-row items-center justify-center gap-2">
        {Array.from({ length }).map((_, i) => {
          const digit = val[i];
          const isCursor = cursorAt === i;
          const state = isError
            ? isCursor
              ? 'errorFocused'
              : 'error'
            : isCursor
              ? 'focused'
              : 'idle';

          return (
            <View
              key={i}
              className={otpCellVariants({ size, state })}
              style={{
                height: size === 'compact' ? visual.controlHeightDefault : visual.controlHeightLg,
                borderRadius: visual.radiusMd,
                borderWidth: isCursor ? visual.borderWidthEmphasis : visual.borderWidthControl,
              }}
            >
              {digit ? (
                <Text
                  className={cn('text-foreground font-semibold')}
                  style={typographyStyle(visual, size === 'compact' ? 'body' : 'emphasis')}
                >
                  {secure ? '●' : digit}
                </Text>
              ) : isCursor ? (
                <CursorBlink color={isError ? colors.destructive : colors.primary} />
              ) : null}
            </View>
          );
        })}
      </Animated.View>

      {/* Keep the native input full-size so every cell is tappable. Opacity is
          required because Android can still paint composing text even when its
          text color is transparent. */}
      <TextInput
        value={val}
        onChangeText={update}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        autoFocus={autoFocus}
        editable={!disabled}
        caretHidden
        className="outline-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0,
          color: 'transparent',
        }}
        accessibilityLabel={`Enter ${length}-digit verification code`}
      />
    </View>
  );
}

function CursorBlink({ color }: { color: string }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    const cycle = () => {
      opacity.value = withSequence(
        withTiming(0, { duration: 400 }),
        withTiming(1, { duration: 400 })
      );
    };
    cycle();
    const id = setInterval(cycle, 800);
    return () => clearInterval(id);
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ width: 2, height: 20, borderRadius: 1, backgroundColor: color }, style]}
    />
  );
}

OTPInput.displayName = 'OTPInput';

export { OTPInput, otpCellVariants };
