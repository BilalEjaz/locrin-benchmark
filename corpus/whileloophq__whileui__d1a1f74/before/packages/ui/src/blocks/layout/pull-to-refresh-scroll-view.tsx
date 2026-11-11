import { RefreshControl, ScrollView, type ScrollViewProps } from 'react-native';
import { useThemeColors } from '../../lib/theme-colors';
import { cn } from '../../lib/cn';

const REFRESH_ACTION = 'refresh';

export interface PullToRefreshScrollViewProps extends Omit<ScrollViewProps, 'refreshControl'> {
  refreshing: boolean;
  /**
   * Refreshing is almost always async, so the signature says so. Nothing here awaits it —
   * the spinner is driven by `refreshing`, which the owner controls — so a handler that
   * can reject must catch its own errors.
   */
  onRefresh: () => void | Promise<void>;
  /** Override tint/colors. Defaults to theme primary. */
  refreshColor?: string;
}

export function PullToRefreshScrollView({
  refreshing,
  onRefresh,
  refreshColor,
  className,
  children,
  alwaysBounceVertical = true,
  accessibilityActions,
  onAccessibilityAction,
  ...props
}: PullToRefreshScrollViewProps) {
  const colors = useThemeColors();
  const tintColor = refreshColor ?? colors.primary;

  // Pulling is a drag, and a screen reader user cannot drag. The same refresh is
  // offered as a named accessibility action, alongside any the caller supplies.
  const actions = [
    ...(accessibilityActions ?? []).filter((action) => action.name !== REFRESH_ACTION),
    { name: REFRESH_ACTION, label: 'Refresh' },
  ];
  const handleAccessibilityAction: ScrollViewProps['onAccessibilityAction'] = (event) => {
    if (event.nativeEvent.actionName === REFRESH_ACTION) {
      if (!refreshing) void onRefresh();
      return;
    }
    onAccessibilityAction?.(event);
  };

  return (
    <ScrollView
      className={cn('flex-1', className)}
      alwaysBounceVertical={alwaysBounceVertical}
      accessibilityActions={actions}
      onAccessibilityAction={handleAccessibilityAction}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={tintColor}
          colors={[tintColor]}
        />
      }
      {...props}
    >
      {children}
    </ScrollView>
  );
}
