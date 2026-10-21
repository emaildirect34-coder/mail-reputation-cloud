import { Link } from "@tanstack/react-router";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
        ED
      </span>
      <span className={`font-display text-lg font-semibold ${inverted ? "text-ink-foreground" : "text-foreground"}`}>
        Email Direct
      </span>
    </Link>
  );
}
