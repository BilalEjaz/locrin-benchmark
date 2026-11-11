import React from 'react';
import {
  Platform,
  Pressable as RNPressable,
  type PressableInstance,
  type PressableProps as RNPressableProps,
  type PressableStateCallbackType,
  type ViewStyle,
} from 'react-native';
import { cn } from '../../lib/cn';
import {
  useInteractionTokens,
  type DisabledVariant,
  type PressedVariant,
} from '../../lib/interaction-tokens';
import { useMotionPolicy } from '../../lib/motion-policy';
import type { ForwardRefComponent } from '../../lib/ref-types';

export interface PressableProps extends RNPressableProps {
  className?: string;
  /** Semantic press feedback. `none` preserves a plain React Native Pressable. */
  feedback?: PressedVariant;
  /** Opacity used while the control is unavailable. */
  disabledFeedback?: DisabledVariant;
  /** Loading controls are busy and non-interactive, just like disabled controls. */
  loading?: boolean;
}

function pressedOpacity(variant: PressedVariant, tokens: ReturnType<typeof useInteractionTokens>) {
  if (variant === 'none') return 1;
  return variant === 'strong' ? tokens.pressOpacityStrong : tokens.pressOpacity;
}

function disabledOpacity(
  variant: DisabledVariant,
  tokens: ReturnType<typeof useInteractionTokens>
) {
  if (variant === 'none') return 1;
  if (variant === 'soft') return tokens.disabledOpacitySoft;
  if (variant === 'subtle') return tokens.disabledOpacitySubtle;
  return tokens.disabledOpacity;
}

const Pressable: ForwardRefComponent<PressableInstance, PressableProps> = React.forwardRef(
  (
    {
      className,
      feedback = 'none',
      disabledFeedback = 'default',
      loading = false,
      disabled = false,
      accessibilityState,
      style,
      ...props
    },
    ref
  ) => {
    const interaction = useInteractionTokens();
    const motion = useMotionPolicy();
    const unavailable = disabled || loading;
    const restingOpacity = unavailable ? disabledOpacity(disabledFeedback, interaction) : 1;
    const activeOpacity = pressedOpacity(feedback, interaction);
    const resolveStyle = (state: PressableStateCallbackType) => {
      const callerStyle = typeof style === 'function' ? style(state) : style;
      const feedbackOpacity = unavailable
        ? restingOpacity
        : state.pressed && feedback !== 'none'
          ? activeOpacity
          : undefined;
      const feedbackStyle =
        feedbackOpacity === undefined ? null : ({ opacity: feedbackOpacity } as ViewStyle);

      if (Platform.OS !== 'web') return [callerStyle, feedbackStyle];

      const transition = motion.animationsEnabled
        ? ({
            transitionProperty: 'opacity',
            transitionDuration: `${motion.durations.fast}ms`,
            transitionTimingFunction: 'ease-out',
          } as ViewStyle)
        : null;
      return [callerStyle, transition, feedbackStyle];
    };

    return (
      <RNPressable
        ref={ref}
        className={cn(className)}
        disabled={unavailable}
        accessibilityState={{
          ...accessibilityState,
          disabled: unavailable || accessibilityState?.disabled,
          busy: loading || accessibilityState?.busy,
        }}
        aria-busy={loading || undefined}
        style={resolveStyle}
        {...props}
      />
    );
  }
);

Pressable.displayName = 'Pressable';

export { Pressable };
