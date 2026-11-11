import { View, type ViewProps } from 'react-native';
import { Text } from '../../components/text';
import { cn } from '../../lib/cn';
import { useVisualTokens } from '../../lib/visual-tokens';
import { typographyStyle } from '../../lib/recipes';

export type UsageBarVariant = 'default' | 'warning' | 'exceeded';

export interface UsageBarProps extends ViewProps {
  label: string;
  used: number;
  limit: number;
  variant?: UsageBarVariant;
  className?: string;
}

function getUsageVariant(used: number, limit: number, variant?: UsageBarVariant): UsageBarVariant {
  if (variant) return variant;
  if (limit <= 0) return 'exceeded';

  const ratio = used / limit;
  if (ratio >= 1) return 'exceeded';
  if (ratio >= 0.8) return 'warning';
  return 'default';
}

export function UsageBar({ label, used, limit, variant, className, ...props }: UsageBarProps) {
  const visual = useVisualTokens();
  const resolvedVariant = getUsageVariant(used, limit, variant);
  const safeLimit = limit <= 0 ? 1 : limit;
  const clamped = Math.max(0, Math.min(100, (used / safeLimit) * 100));

  const progressClass =
    resolvedVariant === 'exceeded'
      ? 'bg-destructive'
      : resolvedVariant === 'warning'
        ? 'bg-warning'
        : 'bg-primary';

  const captionClass =
    resolvedVariant === 'exceeded'
      ? 'text-destructive'
      : resolvedVariant === 'warning'
        ? 'text-warning'
        : 'text-muted-foreground';

  return (
    <View className={cn('gap-2', className)} {...props}>
      <View className="flex-row items-center justify-between">
        <Text className="font-medium text-foreground" style={typographyStyle(visual, 'label')}>
          {label}
        </Text>
        <Text className={cn(captionClass)} style={typographyStyle(visual, 'caption')}>
          {used}/{limit}
        </Text>
      </View>
      <View className="h-2 overflow-hidden bg-muted" style={{ borderRadius: visual.radiusSm }}>
        <View
          className={cn('h-full', progressClass)}
          style={{ borderRadius: visual.radiusSm, width: `${clamped}%` }}
        />
      </View>
    </View>
  );
}
