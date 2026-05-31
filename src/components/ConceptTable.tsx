import { useEffect, useRef, type ReactNode } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Concept } from '../types';
import { conceptId } from '../data/conceptId';
import type { ChangeKind } from '../data/pendingChanges';
import { linkDomain } from './linkDomain';
import { MathML } from './MathML';

const columnHelper = createColumnHelper<Concept>();

/** Per-row callbacks the display columns reach through TanStack's table `meta`. */
type TableMeta = {
  onEdit?: (c: Concept) => void;
  onDelete?: (c: Concept) => void;
  changeKind?: (c: Concept) => ChangeKind | null;
};

const columns = [
  columnHelper.accessor('slug', { header: 'Concept', size: 240 }),
  columnHelper.accessor('en', { header: 'Speech (en)', size: 280 }),
  columnHelper.accessor('area', { header: 'Area', size: 180 }),
  columnHelper.accessor((c) => c.mathml[0] ?? '', {
    id: 'notation',
    header: 'Notation',
    size: 320,
    cell: (info) => <MathML markup={info.getValue()} className="mathml" />,
  }),
  columnHelper.accessor((c) => c.links, {
    id: 'links',
    header: 'Links',
    size: 220,
    cell: (info) => (
      <div className="link-chips">
        {info.getValue().map((url, i) => (
          <a
            key={i}
            className="link-chip"
            href={url}
            target="_blank"
            rel="noreferrer"
            title={url}
          >
            {linkDomain(url)}
          </a>
        ))}
      </div>
    ),
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    size: 84,
    cell: ({ row, table }) => {
      const meta = table.options.meta as TableMeta | undefined;
      const onEdit = meta?.onEdit;
      const onDelete = meta?.onDelete;
      if (!onEdit && !onDelete) return null; // hidden unless editing is allowed (signed in)
      const deleted = meta?.changeKind?.(row.original) === 'deleted';
      return (
        <span className="row-actions">
          {onEdit && (
            <button
              type="button"
              className="row-edit"
              aria-label={`Edit ${row.original.slug}`}
              title="Edit row"
              onClick={() => onEdit(row.original)}
            >
              ✎
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="row-x"
              aria-label={`${deleted ? 'Restore' : 'Delete'} ${row.original.slug}`}
              title={deleted ? 'Restore row' : 'Delete row'}
              onClick={() => onDelete(row.original)}
            >
              {deleted ? '↺' : '✗'}
            </button>
          )}
        </span>
      );
    },
  }),
];

const ROW_HEIGHT = 40;

/** Trigger `onLoadMore` when the user pages within this many rows of the loaded bottom. */
const LOAD_THRESHOLD = 20;

export function ConceptTable({
  data,
  total,
  onEdit,
  onLoadMore,
  editingId,
  onDelete,
  changeKind,
  headerActions,
}: {
  /** The exact rows to render (the paged prefix, or the full filtered set when a filter is active). */
  data: Concept[];
  /** Total rows available; `data.length < total` means more can be paged in (disabled while filtering). */
  total: number;
  /** Per-row edit (the ✎ button); rows themselves are not clickable. */
  onEdit?: (concept: Concept) => void;
  onLoadMore?: () => void;
  /** conceptId of the row being edited — highlighted and scrolled to centre while the modal is open. */
  editingId?: string | null;
  /** Per-row delete/restore (the ✗ / ↺ button). */
  onDelete?: (concept: Concept) => void;
  /** Classify a row's pending change (added / changed / deleted) for its background colour. */
  changeKind?: (concept: Concept) => ChangeKind | null;
  /** Buttons rendered as a phantom rightmost column in the sticky header (Add entry + batch Save). */
  headerActions?: ReactNode;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: { onEdit, onDelete, changeKind },
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const totalWidth = table.getTotalSize();
  const items = virtualizer.getVirtualItems();

  // Page in more data when the rendered window approaches the end of what's loaded.
  const lastIndex = items.length ? items[items.length - 1].index : 0;
  useEffect(() => {
    if (data.length < total && lastIndex >= rows.length - LOAD_THRESHOLD) onLoadMore?.();
  }, [lastIndex, rows.length, data.length, total, onLoadMore]);

  // When a row opens in the editor, scroll it to the centre (it sits behind the centred modal).
  useEffect(() => {
    if (!editingId) return;
    const idx = rows.findIndex((r) => conceptId(r.original) === editingId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  return (
    <div className="table-scroll" ref={scrollRef} data-testid="table-scroll">
      {/* width is intrinsic (max-content) so the phantom header-actions column extends the table to its
          right; minWidth keeps it at least as wide as the data columns. */}
      <div className="table-inner" style={{ minWidth: totalWidth }}>
        <div className="thead">
          {table.getHeaderGroups().map((hg) => (
            <div className="tr" key={hg.id}>
              {hg.headers.map((h) => (
                <div className="th" key={h.id} style={{ width: h.getSize() }}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </div>
              ))}
              {headerActions && (
                <div className="th th-actions" key="__header-actions">
                  {headerActions}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="tbody" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((vi) => {
            const row = rows[vi.index];
            const kind = changeKind?.(row.original) ?? null;
            return (
              <div
                className={`tr${conceptId(row.original) === editingId ? ' row-editing' : ''}${
                  kind ? ` row-${kind}` : ''
                }`}
                key={row.id}
                data-index={vi.index}
                data-row-index={vi.index}
                data-slug={row.original.slug}
                ref={virtualizer.measureElement} // dynamic height: rows grow when Links wrap
                style={{ transform: `translateY(${vi.start}px)`, minHeight: ROW_HEIGHT }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div className="td" key={cell.id} style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
