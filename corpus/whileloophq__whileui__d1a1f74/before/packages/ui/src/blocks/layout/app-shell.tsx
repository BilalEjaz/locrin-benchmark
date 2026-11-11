import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cn } from '../../lib/cn';

export interface AppShellProps extends ViewProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  bottomNav?: React.ReactNode;
  safeArea?: boolean;
  /** Keep shell mounted while swapping content with skeleton. */
  loading?: boolean;
  /** Optional custom loading placeholder for the content area. */
  skeleton?: React.ReactNode;
}

export function AppShell({
  header,
  footer,
  bottomNav,
  safeArea = true,
  loading = false,
  skeleton,
  children,
  className,
  ...props
}: AppShellProps) {
  // `className` is silently dropped on react-native-safe-area-context's `SafeAreaView`:
  // it is a native view, and Uniwind only wraps React Native's own components. Styling
  // the safe area directly meant `AppShell` rendered with no background and no `flex-1`
  // whenever `safeArea` was true — which is the default — and correctly when it was
  // false. So the safe area stays bare and every style goes on the child.
  const shell = (
    <View className={cn('flex-1 bg-background', className)} {...props}>
      {header}
      <View className="flex-1">{loading ? (skeleton ?? null) : children}</View>
      {footer}
      {bottomNav}
    </View>
  );

  if (!safeArea) return shell;

  return <SafeAreaView style={styles.fill}>{shell}</SafeAreaView>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
