import React from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useUniwind } from 'uniwind';
import { formatRgb, parse } from 'culori';
import { type ThemeColors, useThemeColors } from './theme-colors';
import { type VisualTokens, useVisualTokens } from './visual-tokens';
declare const require: undefined | ((id: string) => unknown);

export type FrostedTintToken = 'surfaceElevated' | 'surfaceTranslucent' | 'card' | 'popover';
export type FrostedBlurPreset = 'subtle' | 'medium' | 'strong';

export interface FrostedSurfaceProps {
  frosted?: boolean;
  blurIntensity?: number;
  blurTintToken?: FrostedTintToken;
}

interface UseFrostedSurfaceOptions extends FrostedSurfaceProps {
  defaultTintToken: FrostedTintToken;
  defaultBlurPreset?: FrostedBlurPreset;
}

interface FrostedSurfaceResult {
  frosted: boolean;
  overlay: React.ReactNode;
  surfaceStyle: ViewStyle | undefined;
}

type BlurTint = string;

interface BlurViewProps {
  intensity?: number;
  tint?: BlurTint;
  experimentalBlurMethod?: 'none' | 'dimezisBlurView';
  style?: ViewStyle | ViewStyle[];
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
}

type BlurViewComponent = React.ComponentType<BlurViewProps>;
// Consumers register their own BlurView — expo-blur's, or something else entirely — and
// its props are theirs, not ours. Props are contravariant, so `any` is the only type
// that accepts every component a caller could legitimately hand us.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegisteredBlurViewComponent = React.ComponentType<any>;

let cachedBlurViewComponent: BlurViewComponent | null | undefined;
let registeredBlurViewComponent: RegisteredBlurViewComponent | null = null;

/**
 * Registers the app's BlurView implementation (e.g. from expo-blur).
 * Keep this opt-in so consumers who do not install blur libraries still compile.
 */
export function registerFrostedBlurView(
  blurView: RegisteredBlurViewComponent | null | undefined
): void {
  registeredBlurViewComponent = blurView ?? null;
  cachedBlurViewComponent = undefined;
}

function getBlurViewComponent(): BlurViewComponent | null {
  if (registeredBlurViewComponent) {
    return registeredBlurViewComponent as BlurViewComponent;
  }

  if (cachedBlurViewComponent !== undefined) {
    return cachedBlurViewComponent;
  }

  const runtimeRequire =
    typeof require === 'function'
      ? require
      : ((globalThis as { require?: (id: string) => unknown }).require ?? null);
  if (!runtimeRequire) {
    cachedBlurViewComponent = null;
    return cachedBlurViewComponent;
  }

  try {
    const packageName = ['expo', 'blur'].join('-');
    const maybeBlurModule = runtimeRequire(packageName) as { BlurView?: BlurViewComponent };
    cachedBlurViewComponent =
      typeof maybeBlurModule?.BlurView === 'function' ? maybeBlurModule.BlurView : null;
  } catch {
    cachedBlurViewComponent = null;
  }

  return cachedBlurViewComponent;
}

function resolveTintColor(colors: ThemeColors, tintToken: FrostedTintToken): string {
  if (tintToken === 'card') return colors.card;
  if (tintToken === 'popover') return colors.popover;
  if (tintToken === 'surfaceTranslucent') return colors.surfaceTranslucent;
  return colors.surfaceElevated;
}

function scaleColorAlpha(color: string, alphaScale: number): string {
  if (alphaScale === 1) return color;

  try {
    const parsed = parse(color);
    if (!parsed) return color;

    const currentAlpha = typeof parsed.alpha === 'number' ? parsed.alpha : 1;
    if (currentAlpha >= 1) return color;

    const nextColor = {
      ...parsed,
      alpha: Math.min(1, Math.max(0, currentAlpha * alphaScale)),
    };

    return formatRgb(nextColor) ?? color;
  } catch {
    return color;
  }
}

function resolveBlurIntensity(
  visualTokens: VisualTokens,
  blurIntensity: number | undefined,
  preset: FrostedBlurPreset
): number {
  if (typeof blurIntensity === 'number' && Number.isFinite(blurIntensity)) {
    return Math.max(0, Math.round(blurIntensity));
  }

  if (preset === 'subtle') return visualTokens.blurIntensitySubtle;
  if (preset === 'strong') return visualTokens.blurIntensityStrong;
  return visualTokens.blurIntensityMedium;
}

function getInsetAbsoluteFillStyle(): ViewStyle {
  const inset = Math.max(0, StyleSheet.hairlineWidth);
  if (inset <= 0) {
    return StyleSheet.absoluteFill as ViewStyle;
  }
  return {
    position: 'absolute',
    top: inset,
    right: inset,
    bottom: inset,
    left: inset,
  };
}

function FrostedOverlay({
  intensity,
  tintColor,
  highlightColor,
  saturationPct,
  highlightHeight,
  androidExperimentalBlurEnabled,
}: {
  intensity: number;
  tintColor: string;
  highlightColor: string;
  saturationPct: number;
  highlightHeight: number;
  androidExperimentalBlurEnabled: boolean;
}) {
  const { theme } = useUniwind();
  const BlurView = getBlurViewComponent();
  const blurTint: BlurTint = theme === 'dark' ? 'dark' : 'light';
  const blurProps =
    Platform.OS === 'android' && androidExperimentalBlurEnabled
      ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
      : undefined;
  const showHighlight = highlightHeight > 0;
  const blurFill = getInsetAbsoluteFillStyle();
  const tintFill = StyleSheet.absoluteFill as ViewStyle;
  const highlightInset = Math.max(0, StyleSheet.hairlineWidth);

  if (!BlurView && Platform.OS === 'web') {
    const webStyle = {
      backdropFilter: `blur(${intensity}px) saturate(${saturationPct}%)`,
      WebkitBackdropFilter: `blur(${intensity}px) saturate(${saturationPct}%)`,
    } as ViewStyle;
    return (
      <>
        <View pointerEvents="none" style={[tintFill, webStyle, { backgroundColor: tintColor }]} />
        {showHighlight ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: highlightInset,
              left: highlightInset,
              right: highlightInset,
              height: highlightHeight,
              backgroundColor: highlightColor,
              borderTopLeftRadius: 999,
              borderTopRightRadius: 999,
            }}
          />
        ) : null}
      </>
    );
  }

  if (!BlurView) {
    return (
      <>
        <View pointerEvents="none" style={[tintFill, { backgroundColor: tintColor }]} />
        {showHighlight ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: highlightInset,
              left: highlightInset,
              right: highlightInset,
              height: highlightHeight,
              backgroundColor: highlightColor,
              borderTopLeftRadius: 999,
              borderTopRightRadius: 999,
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line react-hooks/static-components -- `getBlurViewComponent`
          returns a module-level cached component, so this identity is stable across
          renders. The rule cannot see through the cache. */}
      <BlurView
        pointerEvents="none"
        intensity={intensity}
        tint={blurTint}
        {...blurProps}
        style={blurFill}
      />
      <View pointerEvents="none" style={[tintFill, { backgroundColor: tintColor }]} />
      {showHighlight ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: highlightInset,
            left: highlightInset,
            right: highlightInset,
            height: highlightHeight,
            backgroundColor: highlightColor,
            borderTopLeftRadius: 999,
            borderTopRightRadius: 999,
          }}
        />
      ) : null}
    </>
  );
}

function FrostedBackdropOverlay({
  intensity,
  tintColor,
  saturationPct,
  androidExperimentalBlurEnabled,
}: {
  intensity: number;
  tintColor: string;
  saturationPct: number;
  androidExperimentalBlurEnabled: boolean;
}) {
  const { theme } = useUniwind();
  const BlurView = getBlurViewComponent();
  const blurTint: BlurTint = theme === 'dark' ? 'dark' : 'light';
  const blurProps =
    Platform.OS === 'android' && androidExperimentalBlurEnabled
      ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
      : undefined;
  const blurFill = getInsetAbsoluteFillStyle();
  const tintFill = StyleSheet.absoluteFill as ViewStyle;

  if (!BlurView && Platform.OS === 'web') {
    const webStyle = {
      backdropFilter: `blur(${intensity}px) saturate(${saturationPct}%)`,
      WebkitBackdropFilter: `blur(${intensity}px) saturate(${saturationPct}%)`,
    } as ViewStyle;
    return (
      <View pointerEvents="none" style={[tintFill, webStyle, { backgroundColor: tintColor }]} />
    );
  }

  if (!BlurView) {
    return <View pointerEvents="none" style={[tintFill, { backgroundColor: tintColor }]} />;
  }

  return (
    <>
      {/* eslint-disable-next-line react-hooks/static-components -- `getBlurViewComponent`
          returns a module-level cached component, so this identity is stable across
          renders. The rule cannot see through the cache. */}
      <BlurView
        pointerEvents="none"
        intensity={intensity}
        tint={blurTint}
        {...blurProps}
        style={blurFill}
      />
      <View pointerEvents="none" style={[tintFill, { backgroundColor: tintColor }]} />
    </>
  );
}

export function useFrostedSurface({
  frosted = false,
  blurIntensity,
  blurTintToken,
  defaultTintToken,
  defaultBlurPreset = 'medium',
}: UseFrostedSurfaceOptions): FrostedSurfaceResult {
  const colors = useThemeColors();
  const visualTokens = useVisualTokens();

  if (!frosted) {
    return {
      frosted: false,
      overlay: null,
      surfaceStyle: undefined,
    };
  }

  const tintToken = blurTintToken ?? defaultTintToken;
  const tintColor = resolveTintColor(colors, tintToken);
  const resolvedTintColor =
    Platform.OS === 'android'
      ? scaleColorAlpha(tintColor, visualTokens.androidFrostedTintAlphaScale)
      : tintColor;
  const intensity = resolveBlurIntensity(visualTokens, blurIntensity, defaultBlurPreset);
  const highlightColor = colors.surfaceHighlight;
  const highlightHeight = visualTokens.frostedHighlightHeight;
  const saturationPct = visualTokens.blurSaturationPct;
  const androidExperimentalBlurEnabled = visualTokens.androidExperimentalBlurEnabled;

  return {
    frosted: true,
    overlay: (
      <FrostedOverlay
        intensity={intensity}
        tintColor={resolvedTintColor}
        highlightColor={highlightColor}
        highlightHeight={highlightHeight}
        saturationPct={saturationPct}
        androidExperimentalBlurEnabled={androidExperimentalBlurEnabled}
      />
    ),
    surfaceStyle: {
      backgroundColor: 'transparent',
      borderColor: colors.surfaceBorder,
    },
  };
}

interface UseFrostedBackdropOptions {
  frosted?: boolean;
  blurIntensity?: number;
  tintColor?: string;
}

export function useFrostedBackdrop({
  frosted = false,
  blurIntensity,
  tintColor,
}: UseFrostedBackdropOptions): React.ReactNode {
  const colors = useThemeColors();
  const visualTokens = useVisualTokens();

  if (!frosted) return null;

  const intensity =
    typeof blurIntensity === 'number' && Number.isFinite(blurIntensity)
      ? Math.max(0, Math.round(blurIntensity))
      : visualTokens.frostedBackdropBlurIntensity;
  const resolvedTintColor =
    Platform.OS === 'android'
      ? scaleColorAlpha(tintColor ?? colors.overlay, visualTokens.androidFrostedTintAlphaScale)
      : (tintColor ?? colors.overlay);

  return (
    <FrostedBackdropOverlay
      intensity={intensity}
      tintColor={resolvedTintColor}
      saturationPct={visualTokens.blurSaturationPct}
      androidExperimentalBlurEnabled={visualTokens.androidExperimentalBlurEnabled}
    />
  );
}
