/**
 * TenantRail — left pane in /console. Lists tenants with provision/delete.
 */
import type { TenantSummary } from "../../api/admin";

interface Props {
  tenants: TenantSummary[];
  selected: string | null;
  onSelect: (tid: string) => void;
  onProvision: () => void;
  onDelete: (tid: string) => void;
}

export default function TenantRail({
  tenants, selected, onSelect, onProvision, onDelete,
}: Props) {
  return (
    <aside className="tenant-rail">
      <div className="head">
        <div>
          <div className="label">Tenants</div>
          <div className="count">{tenants.length}</div>
        </div>
        <button onClick={onProvision}>+ provision</button>
      </div>

      <div className="scroll thin-scroll">
        {tenants.length === 0 && (
          <div className="empty-rail">
            None yet — provision your first tenant to begin.
          </div>
        )}
        {tenants.map((t) => (
          <div
            key={t.tenant_id}
            className={`tenant-row ${selected === t.tenant_id ? "selected" : ""}`}
            onClick={() => onSelect(t.tenant_id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect(t.tenant_id)}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="tid">{t.tenant_id}</div>
              <div className="display">{t.display_name}</div>
            </div>
            <button
              className="del"
              onClick={(e) => { e.stopPropagation(); onDelete(t.tenant_id); }}
              aria-label={`Delete ${t.tenant_id}`}
            >×</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
