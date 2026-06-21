'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const skeletonVariants = cva('animate-pulse rounded-md bg-muted', {
  variants: {
    variant: {
      default: 'bg-muted/70',
      strong: 'bg-muted',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof skeletonVariants>) {
  return <div className={cn(skeletonVariants({ variant: props.variant }), className)} {...props} />;
}

export { Skeleton };
