import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "text-card-foreground flex flex-col gap-6 py-6 transition-all duration-200",
        className
      )}
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.10)',
        backdropFilter: 'blur(24px) saturate(200%)',
        WebkitBackdropFilter: 'blur(24px) saturate(200%)',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.20)',
        boxShadow:
          'inset 0 1px 1px 0 rgba(255,255,255,0.25), ' +
          'inset 0 -1px 1px 0 rgba(255,255,255,0.05), ' +
          '0 2px 4px 0 rgba(0,0,0,0.20), ' +
          '0 12px 40px -8px rgba(0,0,0,0.40)',
        transform: 'translateZ(0)',
        ...style,
      }}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
