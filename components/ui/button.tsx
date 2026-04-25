import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-all disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-hover shadow-sm active:translate-y-px",
        outline: "border border-paper-line bg-paper-card text-ink hover:bg-paper-subtle",
        ghost: "text-ink hover:bg-paper-subtle",
        danger: "bg-danger text-white hover:opacity-90 active:translate-y-px",
        subtle: "bg-paper-subtle text-ink hover:bg-paper-line",
      },
      size: {
        default: "h-9 px-3.5 text-sm",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-10 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";
