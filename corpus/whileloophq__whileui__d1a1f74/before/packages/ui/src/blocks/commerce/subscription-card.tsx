import { type ViewProps, View } from 'react-native';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/card';
import { Button, ButtonText } from '../../components/button';
import { Badge, BadgeText } from '../../components/badge';
import { Skeleton } from '../../components/skeleton';
import { Text } from '../../components/text';
import { cn } from '../../lib/cn';
import { useVisualTokens } from '../../lib/visual-tokens';
import { typographyStyle } from '../../lib/recipes';

export interface SubscriptionCardProps extends ViewProps {
  planName: string;
  price: string;
  period?: string;
  expiresAt?: string;
  isActive?: boolean;
  onManage?: () => void;
  onUpgrade?: () => void;
  manageLabel?: string;
  upgradeLabel?: string;
  /** Show a skeleton placeholder instead of content. */
  loading?: boolean;
  className?: string;
}

function SubscriptionCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <View className="flex-row items-center justify-between">
          <Skeleton className="h-5 w-1/3 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </View>
      </CardHeader>
      <CardContent className="gap-2">
        <View className="flex-row items-baseline gap-1">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-3 w-12 rounded-md" />
        </View>
        <Skeleton className="h-3 w-2/5 rounded-md" />
      </CardContent>
      <CardFooter className="gap-2">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 flex-1 rounded-lg" />
      </CardFooter>
    </Card>
  );
}

export function SubscriptionCard({
  planName,
  price,
  period = '/month',
  expiresAt,
  isActive = true,
  onManage,
  onUpgrade,
  manageLabel = 'Manage plan',
  upgradeLabel = 'Upgrade',
  loading = false,
  className,
  ...props
}: SubscriptionCardProps) {
  const visual = useVisualTokens();

  if (loading) {
    return <SubscriptionCardSkeleton className={className} />;
  }

  const label = typographyStyle(visual, 'label');

  return (
    <Card className={cn(className)} {...props}>
      <CardHeader className="pb-2">
        <View className="flex-row items-center justify-between">
          <CardTitle>{planName}</CardTitle>
          <Badge variant={isActive ? 'success' : 'secondary'}>
            <BadgeText>{isActive ? 'Active' : 'Inactive'}</BadgeText>
          </Badge>
        </View>
      </CardHeader>
      <CardContent className="gap-2">
        <View className="flex-row items-baseline gap-1">
          <Text className="text-2xl font-bold text-foreground">{price}</Text>
          <Text className="text-muted-foreground" style={label}>
            {period}
          </Text>
        </View>
        {expiresAt ? (
          <Text className="text-muted-foreground" style={label}>
            Renews on {expiresAt}
          </Text>
        ) : (
          <Text className="text-muted-foreground" style={label}>
            No renewal date set
          </Text>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" onPress={onManage} disabled={!onManage}>
          <ButtonText>{manageLabel}</ButtonText>
        </Button>
        <Button onPress={onUpgrade} disabled={!onUpgrade}>
          <ButtonText>{upgradeLabel}</ButtonText>
        </Button>
      </CardFooter>
    </Card>
  );
}
