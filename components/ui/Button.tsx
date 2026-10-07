import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover px-5 py-3",
  secondary:
    "bg-surface text-foreground border border-border hover:border-accent px-5 py-3",
  ghost: "text-muted-foreground hover:text-foreground px-3 py-2",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className = "", variant = "primary", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    />
  );
});
