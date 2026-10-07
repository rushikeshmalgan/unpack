import { TextareaHTMLAttributes, forwardRef } from "react";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className = "", invalid = false, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid}
      className={`w-full rounded-lg border bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        invalid ? "border-danger" : "border-border"
      } ${className}`}
      {...props}
    />
  );
});
