"use client";

import {
  useId,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { Input as BaseInput } from "@base-ui/react/input";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { OfficialSource, SourceAsset } from "./assets";
import { useSourceTheme } from "./theme";

export function cx(...values: (string | undefined | false)[]) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "className"> & {
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};
export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("ft-button", className)}
      data-variant={variant}
      data-size={size}
    >
      {loading ? <span className="ft-spinner" aria-hidden="true" /> : null}
      {children}
    </BaseButton>
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "success" | "danger";
}) {
  return (
    <span {...props} className={cx("ft-badge", className)} data-tone={tone} />
  );
}
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article {...props} className={cx("ft-card", className)} />;
}
export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ft-card-body", className)} />;
}
export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 {...props} className={cx("ft-card-title", className)} />;
}
export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={cx("ft-card-description", className)} />;
}

type InputProps = Omit<ComponentProps<typeof BaseInput>, "className"> & {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
};
export function Input({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = hint || error ? `${inputId}-description` : undefined;
  return (
    <div>
      <label htmlFor={inputId} className="ft-label">
        {label}
      </label>
      <BaseInput
        {...props}
        id={inputId}
        className={cx("ft-input", className)}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={
          cx(props["aria-describedby"], descriptionId) || undefined
        }
      />
      {descriptionId ? (
        <p id={descriptionId} className={error ? "ft-error" : "ft-help"}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: ComponentProps<"textarea"> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = hint || error ? `${inputId}-description` : undefined;
  return (
    <div>
      <label htmlFor={inputId} className="ft-label">
        {label}
      </label>
      <textarea
        {...props}
        id={inputId}
        className={cx("ft-textarea", className)}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={
          cx(props["aria-describedby"], descriptionId) || undefined
        }
      />
      {descriptionId ? (
        <p id={descriptionId} className={error ? "ft-error" : "ft-help"}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function ChevronDown() {
  return (
    <svg
      className="ft-chevron"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
export function ArrowUpRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
export function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function Checkbox({
  label,
  ...props
}: Omit<ComponentProps<typeof BaseCheckbox.Root>, "className" | "children"> & {
  label: string;
}) {
  return (
    <label className="ft-check-label">
      <BaseCheckbox.Root {...props} className="ft-checkbox">
        <BaseCheckbox.Indicator>
          <CheckIcon />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <span>{label}</span>
    </label>
  );
}
export function Switch({
  label,
  ...props
}: Omit<ComponentProps<typeof BaseSwitch.Root>, "className" | "children"> & {
  label: string;
}) {
  return (
    <label className="ft-check-label">
      <BaseSwitch.Root {...props} className="ft-switch">
        <BaseSwitch.Thumb className="ft-switch-thumb" />
      </BaseSwitch.Root>
      <span>{label}</span>
    </label>
  );
}

export function Select({
  label,
  options,
  value,
  onValueChange,
  name,
  placeholder = "Choisir…",
}: {
  label: string;
  options: { value: string; label: string }[];
  value?: string;
  onValueChange?: (value: string | null) => void;
  name?: string;
  placeholder?: string;
}) {
  const id = useId();
  const theme = useSourceTheme();
  return (
    <div>
      <label id={id} className="ft-label">
        {label}
      </label>
      <BaseSelect.Root
        items={options}
        value={value}
        onValueChange={onValueChange}
        name={name}
      >
        <BaseSelect.Trigger aria-labelledby={id} className="ft-select-trigger">
          <BaseSelect.Value placeholder={placeholder} />
          <BaseSelect.Icon>
            <ChevronDown />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner sideOffset={6} style={{ zIndex: 65 }}>
            <BaseSelect.Popup
              data-ft-source={theme}
              className="ft-select-popup"
            >
              <BaseSelect.List>
                {options.map((option) => (
                  <BaseSelect.Item
                    key={option.value}
                    value={option.value}
                    className="ft-select-item"
                  >
                    <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator>
                      <CheckIcon />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}

export function Tabs({
  items,
  defaultValue,
  value,
  onValueChange,
  label,
}: {
  items: {
    value: string;
    label: string;
    content: ReactNode;
    disabled?: boolean;
  }[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  label: string;
}) {
  return (
    <BaseTabs.Root
      defaultValue={defaultValue ?? items[0]?.value}
      value={value}
      onValueChange={onValueChange}
    >
      <BaseTabs.List aria-label={label} className="ft-tab-list">
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className="ft-tab"
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel
          key={item.value}
          value={item.value}
          className="ft-tab-panel"
        >
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  closeLabel = "Fermer",
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  closeLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const theme = useSourceTheme();
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Trigger className="ft-button" data-variant="secondary">
        {trigger}
      </BaseDialog.Trigger>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ft-backdrop" data-ft-source={theme} />
        <BaseDialog.Popup className="ft-dialog" data-ft-source={theme}>
          <BaseDialog.Title className="ft-dialog-title">
            {title}
          </BaseDialog.Title>
          <BaseDialog.Description className="ft-dialog-description">
            {description}
          </BaseDialog.Description>
          {children}
          <div className="ft-dialog-actions">
            <BaseDialog.Close className="ft-button">
              {closeLabel}
            </BaseDialog.Close>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function Accordion({
  items,
}: {
  items: { id: string; title: string; content: ReactNode }[];
}) {
  return (
    <BaseAccordion.Root>
      {items.map((item) => (
        <BaseAccordion.Item
          key={item.id}
          value={item.id}
          className="ft-accordion-item"
        >
          <BaseAccordion.Header>
            <BaseAccordion.Trigger className="ft-accordion-trigger">
              {item.title}
              <ChevronDown />
            </BaseAccordion.Trigger>
          </BaseAccordion.Header>
          <BaseAccordion.Panel className="ft-accordion-panel">
            {item.content}
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const theme = useSourceTheme();
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger className="ft-button" data-variant="ghost">
          {children}
        </BaseTooltip.Trigger>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={8} style={{ zIndex: 70 }}>
            <BaseTooltip.Popup data-ft-source={theme} className="ft-tooltip">
              {label}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(
    0,
    Math.min(100, Number.isFinite(value) ? value : 0),
  );
  return (
    <div>
      <div className="ft-label">
        {label} <span className="font-mono">{bounded}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
        className="ft-progress-track"
      >
        <div className="ft-progress-fill" style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cx("ft-skeleton", className)}
    />
  );
}
export function Separator() {
  return <hr className="ft-separator" />;
}
export function Breadcrumb({
  items,
  label = "Fil d’Ariane",
}: {
  items: { label: string; href?: string }[];
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="ft-breadcrumb">
        {items.map((item, i) => (
          <li
            key={`${item.label}-${i}`}
            className="inline-flex items-center gap-2"
          >
            {i ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SourceLogo({
  asset,
  className,
  loading = "lazy",
}: {
  asset: SourceAsset;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  return (
    <SourceLogoImage
      key={asset.url}
      asset={asset}
      className={className}
      loading={loading}
    />
  );
}
function SourceLogoImage({
  asset,
  className,
  loading,
}: {
  asset: SourceAsset;
  className?: string;
  loading: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className={className}>
      {asset.alt || new URL(asset.url).hostname}
    </span>
  ) : (
    <img
      src={asset.url}
      alt={asset.alt}
      loading={loading}
      decoding="async"
      className={cx("ft-official-logo", className)}
      onError={() => setFailed(true)}
    />
  );
}

export function SourceCard({ source }: { source: OfficialSource }) {
  const logo = source.images.find((asset) => asset.kind === "logo");
  return (
    <Card>
      <CardBody>
        <Badge>{source.sourceClass}</Badge>
        {logo ? <SourceLogo asset={logo} /> : null}
        <CardTitle lang={source.language ?? undefined}>
          {source.title ?? source.url}
        </CardTitle>
        {source.description ? (
          <CardDescription lang={source.language ?? undefined}>
            {source.description}
          </CardDescription>
        ) : null}
        <p className="ft-help">{source.status}</p>
        <a
          className="ft-button"
          data-variant="secondary"
          href={source.finalUrl ?? source.url}
        >
          Source <ArrowUpRight />
        </a>
      </CardBody>
    </Card>
  );
}
