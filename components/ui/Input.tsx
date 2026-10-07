import { InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className = "", invalid = false, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid}
      className={`w-full rounded-lg border bg-surface px-4 py-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        invalid ? "border-danger" : "border-border"
      } ${className}`}
      {...props}
    />
  );
});
