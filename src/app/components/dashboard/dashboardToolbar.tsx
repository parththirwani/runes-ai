"use client";

import { Grid2x2, List, Search, X } from "lucide-react";
import type { DocumentViewMode } from "@/src/types/dashboard";

interface DashboardToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: DocumentViewMode;
  onViewModeChange: (mode: DocumentViewMode) => void;
  resultCount: number;
  totalCount: number;
  sortOrder: 'updated-desc' | 'updated-asc';
  onSortOrderChange: (value: 'updated-desc' | 'updated-asc') => void;
  labelledBy?: string;
}

export default function DashboardToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  resultCount,
  totalCount,
  sortOrder,
  onSortOrderChange,
  labelledBy = "document-search-label",
}: DashboardToolbarProps) {
  const modeButton = (mode: DocumentViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onViewModeChange(mode)}
      aria-pressed={viewMode === mode}
      aria-label={`${label} view`}
      className={`inline-flex size-11 items-center justify-center rounded-md transition-colors ${
        viewMode === mode
          ? "bg-surface-raised text-foreground"
          : "text-meta hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <label id={labelledBy} htmlFor="document-search" className="sr-only">
          Search documents by title
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta"
          aria-hidden="true"
        />
        <input
          id="document-search"
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by title"
          aria-describedby={`${labelledBy}-count`}
          className="min-h-11 w-full rounded-md border border-border bg-surface py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-0 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p id={`${labelledBy}-count`} role="status" className="font-mono text-xs text-meta">
            {resultCount} of {totalCount} {totalCount === 1 ? "document" : "documents"}
          </p>
          <label className="sr-only" htmlFor="document-sort">Sort documents</label>
          <select
            id="document-sort"
            value={sortOrder}
            onChange={(event) => onSortOrderChange(event.target.value as 'updated-desc' | 'updated-asc')}
            className="min-h-11 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="updated-desc">Newest updated</option>
            <option value="updated-asc">Oldest updated</option>
          </select>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {modeButton("grid", "Grid", <Grid2x2 className="h-4 w-4" aria-hidden="true" />)}
          {modeButton("list", "List", <List className="h-4 w-4" aria-hidden="true" />)}
        </div>
      </div>
    </div>
  );
}
