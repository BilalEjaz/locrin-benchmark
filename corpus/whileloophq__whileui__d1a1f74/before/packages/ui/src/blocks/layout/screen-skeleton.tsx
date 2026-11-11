import { type ViewProps } from 'react-native';
import { type ReactNode } from 'react';
import {
  PageSkeleton,
  type PageSkeletonHeaderPlaceholder,
  type PageSkeletonPadding,
  type PageSkeletonVariant,
} from './page-skeleton';
import { cn } from '../../lib/cn';

export interface ScreenSkeletonProps extends Omit<ViewProps, 'children'> {
  variant?: PageSkeletonVariant;
  count?: number;
  padding?: PageSkeletonPadding;
  header?: ReactNode;
  headerPlaceholder?: boolean | PageSkeletonHeaderPlaceholder;
  className?: string;
}

export function ScreenSkeleton({
  variant = 'generic',
  count,
  padding = 'default',
  header,
  headerPlaceholder = 'default',
  className,
  ...props
}: ScreenSkeletonProps) {
  return (
    <PageSkeleton
      variant={variant}
      count={count}
      padding={padding}
      header={header}
      headerPlaceholder={headerPlaceholder}
      className={cn('flex-1', className)}
      {...props}
    />
  );
}

ScreenSkeleton.displayName = 'ScreenSkeleton';
