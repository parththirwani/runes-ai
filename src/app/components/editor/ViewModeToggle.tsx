"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Code, Eye, Split } from "lucide-react";
import type { ComponentType } from "react";

export type ViewMode = "editor" | "split" | "preview";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  labels?: Partial<Record<ViewMode, string>>;
}

const modes: { id: ViewMode; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>; defaultLabel: string }[] = [
  { id: "editor", icon: Code, defaultLabel: "Code" },
  { id: "split", icon: Split, defaultLabel: "Split" },
  { id: "preview", icon: Eye, defaultLabel: "Reading" },
];

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface-raised data-[state=checked]:font-medium";

/**
 * One View control instead of three side-by-side buttons. The trigger names the current view and
 * the menu is a radio group, so the three modes stay mutually exclusive and keyboard readable.
 */
export default function ViewModeToggle({ value, onChange, labels }: ViewModeToggleProps) {
  const current = modes.find((mode) => mode.id === value) ?? modes[0];
  const CurrentIcon = current.icon;
  const labelFor = (mode: (typeof modes)[number]) => labels?.[mode.id] ?? mode.defaultLabel;
  const currentLabel = labelFor(current);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`View: ${currentLabel}. Change view`}
          title={`View: ${currentLabel}`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-overlay"
        >
          <CurrentIcon className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{currentLabel}</span>
          <ChevronDown className="size-3.5 text-meta" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          aria-label="View"
          className="z-[60] min-w-44 rounded-md border border-border bg-surface-overlay p-1 shadow-overlay"
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as ViewMode)}>
            {modes.map((mode) => {
              const Icon = mode.icon;
              const label = labelFor(mode);
              return (
                <DropdownMenu.RadioItem key={mode.id} value={mode.id} className={itemClass}>
                  <Icon className="size-4 text-meta" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4 text-action" aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
