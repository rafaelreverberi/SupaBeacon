import React, { ReactNode, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Database, LoaderCircle, Radio } from 'lucide-react';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Radio size={23} />
      </span>
      SupaBeacon<span className="version">v1</span>
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}

export function Spinner() {
  return <LoaderCircle className="spin" size={17} />;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Database size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={secondary ? 'button secondary' : 'button'}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id: string }>, { id })
        : children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Pagination({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (v: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} records · page {page} of {Math.max(1, Math.ceil(total / 30))}
      </span>
      <Button
        secondary
        disabled={page === 1}
        label="Previous page"
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft size={15} />
      </Button>
      <Button
        secondary
        disabled={page * 30 >= total}
        label="Next page"
        onClick={() => setPage(page + 1)}
      >
        <ChevronRight size={15} />
      </Button>
    </div>
  );
}

export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={label} onCancel={onClose}>
      {children}
    </dialog>
  );
}
