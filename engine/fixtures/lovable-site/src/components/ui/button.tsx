import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "default", ...props }, ref) => {
  return (
    <button
      className={cn("inline-flex items-center rounded-md px-4 py-2 text-sm font-medium", variant === "outline" && "border", className)}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button };
