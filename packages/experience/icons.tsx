import type { ComponentProps } from "react";
import { Button } from "@fairy/ui";

const paths = {
  layers: "m12 2 10 5-10 5L2 7l10-5Z M2 12l10 5 10-5 M2 17l10 5 10-5",
  play: "m8 4 12 8-12 8V4Z",
  pause: "M8 4v16 M16 4v16",
  reset: "M20 10a8 8 0 1 1-3-5 M17 1v5h5",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z m5 12 6 6",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M20 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  library: "M4 3h4v18H4Z M10 3h4v18h-4Z m6 1 4-1 4 17-4 1-4-17Z",
  external: "M15 3h6v6 M21 3 10 14 M10 3H3v18h18v-7",
  compass: "m16 8-2 6-6 2 2-6 6-2Z M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
  globe:
    "M2 12h20 M12 2c6 6 6 14 0 20-6-6-6-14 0-20Z M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
  book: "M12 5v16 M3 3c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 3-3-3-5-4-9-3V3Z",
  expand: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  close: "m6 6 12 12 M6 18 18 6",
  up: "m5 14 7-7 7 7",
  down: "m5 10 7 7 7-7",
  left: "m14 5-7 7 7 7",
  right: "m10 5 7 7-7 7",
  zoom: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z m5 12 6 6 M7 10h6 M10 7v6",
  fit: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8Z",
  grid: "M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 14h7v7h-7Z",
  info: "M12 11v6 M12 7h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
  image: "M3 3h18v18H3Z m0 14 6-6 4 4 3-3 5 5 M15 7h.01",
  film: "M3 3h18v18H3Z M7 3v18 M17 3v18 M3 8h4 M3 16h4 M17 8h4 M17 16h4",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function IconButton({
  icon,
  label,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  icon: IconName;
  label: string;
}) {
  return (
    <span className="icon-hint" data-hint={label}>
      <Button
        {...props}
        className={`orbit-button ${props.className ?? ""}`}
        aria-label={label}
      >
        <Icon name={icon} />
      </Button>
    </span>
  );
}
