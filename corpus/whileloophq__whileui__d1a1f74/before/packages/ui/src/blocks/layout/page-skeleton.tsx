import { View, type ViewProps, type ViewStyle } from 'react-native';
import { type ReactNode } from 'react';
import { Skeleton } from '../../components/skeleton';
import { Stack } from '../../components/stack';
import { Row } from '../../components/row';
import { cn } from '../../lib/cn';
import { useVisualTokens, type VisualTokens } from '../../lib/visual-tokens';
import { surfacePadding, surfaceRadius } from '../../lib/recipes';

export type PageSkeletonVariant = 'dashboard' | 'list' | 'settings' | 'card' | 'generic';
export type PageSkeletonPadding = 'none' | 'sm' | 'default' | 'lg';
export type PageSkeletonHeaderPlaceholder = 'compact' | 'default';

export interface PageSkeletonProps extends ViewProps {
  variant: PageSkeletonVariant;
  /** Rows/items for list (default 3) or settings (default 4) variant. */
  count?: number;
  /** Container padding. */
  padding?: PageSkeletonPadding;
  /** Optional header slot rendered above skeleton content. */
  header?: ReactNode;
  /** Optional placeholder header (when no real header is available yet). */
  headerPlaceholder?: boolean | PageSkeletonHeaderPlaceholder;
}

function containerPadding(visual: VisualTokens, padding: PageSkeletonPadding): ViewStyle {
  return { padding: surfacePadding(visual, padding) };
}

function cardSurface(visual: VisualTokens): ViewStyle {
  return {
    borderRadius: surfaceRadius(visual, 'xl'),
    borderWidth: visual.borderWidthHairline,
    padding: surfacePadding(visual, 'sm'),
  };
}

function HeaderPlaceholder({ variant }: { variant: PageSkeletonHeaderPlaceholder }) {
  const visual = useVisualTokens();
  const compact = variant === 'compact';

  return (
    <View
      className={cn(compact ? 'pt-3 pb-2' : 'pt-4 pb-3')}
      style={{ paddingHorizontal: surfacePadding(visual, 'sm') }}
    >
      <Row align="center" justify="between">
        <Row align="center" gap="sm">
          <Skeleton className={cn('rounded-full', compact ? 'h-8 w-8' : 'h-10 w-10')} />
          <Stack gap="xs">
            <Skeleton className={cn('h-3 rounded-full', compact ? 'w-24' : 'w-28')} />
            <Skeleton className={cn('h-3 rounded-full', compact ? 'w-16' : 'w-20')} />
          </Stack>
        </Row>
        <Skeleton className={cn('rounded-full', compact ? 'h-8 w-8' : 'h-10 w-10')} />
      </Row>
    </View>
  );
}

function DashboardVariant({
  className,
  padding = 'default',
  style,
  ...props
}: Omit<PageSkeletonProps, 'variant' | 'count'>) {
  const visual = useVisualTokens();

  return (
    <View className={className} style={[containerPadding(visual, padding), style]} {...props}>
      <Stack gap="md">
        {/* Summary card: badges + coach tip */}
        <View className="border-border bg-card" style={cardSurface(visual)}>
          <Row className="mb-3 gap-2" align="center">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </Row>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-1 h-4 w-4/5" />
        </View>

        {/* Macro cards row */}
        <Row gap="sm" align="stretch">
          {[1, 2, 3].map((i) => (
            <View key={i} className="flex-1 border-border bg-card" style={cardSurface(visual)}>
              <Skeleton className="mb-2 h-3 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </View>
          ))}
        </Row>

        {/* Activity list */}
        <Skeleton className="h-4 w-1/3" />
        {[1, 2, 3].map((i) => (
          <Row
            key={i}
            className="items-center gap-3"
            style={{ paddingVertical: visual.controlPaddingYDefault }}
            align="center"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <Stack className="flex-1" gap="xs">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </Stack>
          </Row>
        ))}
      </Stack>
    </View>
  );
}

function ListVariant({
  count = 3,
  className,
  padding = 'default',
  style,
  ...props
}: PageSkeletonProps & { variant: 'list' }) {
  const visual = useVisualTokens();

  return (
    <View className={className} style={[containerPadding(visual, padding), style]} {...props}>
      <Stack gap="md">
        <Skeleton className="h-5 w-1/3" />
        {Array.from({ length: count }).map((_, i) => (
          <Row
            key={i}
            className="items-center gap-3 border-border"
            style={{
              borderBottomWidth: visual.borderWidthHairline,
              paddingBottom: surfacePadding(visual, 'sm'),
            }}
            align="center"
          >
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <Stack className="flex-1" gap="xs">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </Stack>
          </Row>
        ))}
      </Stack>
    </View>
  );
}

function SettingsVariant({
  count = 4,
  className,
  padding = 'default',
  style,
  ...props
}: PageSkeletonProps & { variant: 'settings' }) {
  const visual = useVisualTokens();

  return (
    <View className={className} style={[containerPadding(visual, padding), style]} {...props}>
      <Stack gap="none">
        {Array.from({ length: count }).map((_, i) => (
          <Row
            key={i}
            className="items-center justify-between border-border"
            style={{
              borderBottomWidth: visual.borderWidthHairline,
              paddingVertical: surfacePadding(visual, 'sm'),
            }}
            align="center"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-16" />
          </Row>
        ))}
      </Stack>
    </View>
  );
}

function CardVariant({
  className,
  padding = 'default',
  style,
  ...props
}: Omit<PageSkeletonProps, 'variant' | 'count'>) {
  const visual = useVisualTokens();

  return (
    <View className={className} style={[containerPadding(visual, padding), style]} {...props}>
      <View
        className="border-border bg-card overflow-hidden"
        style={{
          borderRadius: surfaceRadius(visual, 'xl'),
          borderWidth: visual.borderWidthHairline,
        }}
      >
        <View className="gap-3" style={{ padding: surfacePadding(visual, 'sm') }}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/4" />
        </View>
      </View>
    </View>
  );
}

function GenericVariant({
  className,
  padding = 'default',
  style,
  ...props
}: Omit<PageSkeletonProps, 'variant' | 'count'>) {
  const visual = useVisualTokens();

  return (
    <View className={className} style={[containerPadding(visual, padding), style]} {...props}>
      <Stack gap="lg">
        <Skeleton className="h-6 w-1/2" />
        <Stack gap="sm">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
        </Stack>
      </Stack>
    </View>
  );
}

export function PageSkeleton({
  variant,
  count,
  padding = 'default',
  header,
  headerPlaceholder = false,
  className,
  ...props
}: PageSkeletonProps) {
  const resolvedHeaderPlaceholder: PageSkeletonHeaderPlaceholder =
    headerPlaceholder === 'compact' ? 'compact' : 'default';

  return (
    <View className={cn('w-full', className)} {...props}>
      {header}
      {!header && headerPlaceholder && <HeaderPlaceholder variant={resolvedHeaderPlaceholder} />}
      {variant === 'dashboard' ? (
        <DashboardVariant padding={padding} />
      ) : variant === 'list' ? (
        <ListVariant variant="list" count={count ?? 3} padding={padding} />
      ) : variant === 'settings' ? (
        <SettingsVariant variant="settings" count={count ?? 4} padding={padding} />
      ) : variant === 'card' ? (
        <CardVariant padding={padding} />
      ) : (
        <GenericVariant padding={padding} />
      )}
    </View>
  );
}

PageSkeleton.displayName = 'PageSkeleton';
