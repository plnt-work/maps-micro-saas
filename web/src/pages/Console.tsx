/**
 * Console — operator dashboard.
 *
 * Three-pane layout:
 *
 *   ┌───────────┬──────────────────────────────┬───────────┐
 *   │ Tenants   │ Metrics + recent sessions    │ Debug WS  │
 *   └───────────┴──────────────────────────────┴───────────┘
 *
 * Polls the selected tenant's metrics every 3s; refreshes on tenant change
 * and after the debug chat opens a new session.
 *
 * Open by default — no operator sign-in. When PLNT_CLOUD_REQUIRE_AUTH=1
 * flips on, this surface gets re-gated then.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import TenantRail from "../components/console/TenantRail";
import MetricGrid from "../components/console/MetricGrid";
import DebugChat from "../components/console/DebugChat";
import ProvisionDialog from "../components/console/ProvisionDialog";
import {
  deleteTenant, getMetrics, getPlacesStatus, listTenants,
  type PlacesStatus, type TenantMetrics, type TenantSummary,
} from "../api/admin";

const METRICS_POLL_MS = 3000;

export default function Console() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [places, setPlaces] = useState<PlacesStatus | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [debugVer, setDebugVer] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    getPlacesStatus().then(setPlaces).catch(() => setPlaces(null));
  }, []);

  useEffect(() => {
    if (!selected) { setMetrics(null); return; }
    let cancelled = false;
    const refresh = async () => {
      try {
        const m = await getMetrics(selected);
        if (!cancelled) setMetrics(m);
      } catch (e) {
        if (!cancelled) setErr(String((e as Error).message));
      }
    };
    void refresh();
    const t = setInterval(refresh, METRICS_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [selected, debugVer]);

  const reload = async () => {
    try {
      const t = await listTenants();
      setTenants(t);
      if (!selected && t.length) setSelected(t[0]!.tenant_id);
      if (selected && !t.some((x) => x.tenant_id === selected)) {
        setSelected(t.length ? t[0]!.tenant_id : null);
      }
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  const onDelete = async (tid: string) => {
    if (!confirm(`Delete tenant '${tid}' permanently? All conversations, memory, and bookings will be wiped.`)) return;
    try {
      await deleteTenant(tid);
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  const selectedTenant = tenants.find((t) => t.tenant_id === selected) || null;

  return (
    <div className="theme-console">
      <header className="console-topbar">
        <div className="left">
          <Link to="/console" className="brand">Atlas</Link>
          <span className="crumb">console / <b>{selected || "—"}</b></span>
        </div>
        <div className="right">
          <Link to="/atlas" style={{ color: "var(--coal-mute)", borderBottom: "1px solid var(--coal-line)", paddingBottom: 2 }}>
            map surface →
          </Link>
        </div>
      </header>

      <div className="console-body">
        <TenantRail
          tenants={tenants}
          selected={selected}
          onSelect={setSelected}
          onProvision={() => setProvisioning(true)}
          onDelete={onDelete}
        />

        <section className="console-detail thin-scroll">
          {err && (
            <div style={{
              background: "rgba(181,87,46,0.10)",
              border: "1px solid rgba(181,87,46,0.25)",
              color: "var(--rust)",
              padding: "10px 14px", borderRadius: 8, marginBottom: 16,
              fontSize: 13,
            }}>
              {err}
            </div>
          )}

          {selectedTenant ? (
            <>
              <h2 className="h1">{selectedTenant.tenant_id}</h2>
              <div className="home">{selectedTenant.home}</div>
              <MetricGrid metrics={metrics} places={places} />
            </>
          ) : (
            <p style={{ color: "var(--coal-mute)", fontSize: 14 }}>
              Pick a tenant on the left, or provision a new one.
            </p>
          )}
        </section>

        {selected ? (
          <DebugChat
            tenantId={selected}
            resetVersion={debugVer}
            onReset={() => setDebugVer((v) => v + 1)}
          />
        ) : (
          <aside className="debug-rail">
            <div className="head">
              <div>
                <div className="label">Live debug</div>
                <h4>—</h4>
              </div>
            </div>
            <div className="empty-rail">
              Select a tenant to open a debug WebSocket.
            </div>
          </aside>
        )}
      </div>

      {provisioning && (
        <ProvisionDialog
          onCancel={() => setProvisioning(false)}
          onCreated={(t) => {
            setProvisioning(false);
            void reload();
            setSelected(t.tenant_id);
          }}
        />
      )}
    </div>
  );
}
