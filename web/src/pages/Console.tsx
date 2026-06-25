/**
 * Console — operator dashboard, FE-Console-v2 shell.
 *
 * The shape comes from features/console/ConsoleShell.tsx (top bar, nav
 * rail, tabbed main, drawer). This page is just the data plumbing:
 *   - tenants list (react-query)
 *   - selected-tenant state (URL-backed so reload + share work)
 *   - provision + delete mutations
 *
 * No more setInterval; no more 3-pane split. The DebugChat WebSocket
 * lives inside Conversations now (per-transcript drawer).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import ConsoleShell from "../features/console/ConsoleShell";
import ProvisionDialog from "../components/console/ProvisionDialog";
import { deleteTenant, listTenants, type TenantSummary } from "../api/admin";

export default function Console() {
  const qc = useQueryClient();

  const tenantsQ = useQuery({
    queryKey: ["tenants"],
    queryFn: listTenants,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const [params, setParams] = useSearchParams();
  // The user's intended selection. URL is the source of truth; this state
  // only holds an override when no URL param has been set yet.
  const [override, setOverride] = useState<string | null>(null);

  // Effective selection: URL → override → first tenant. All derived in
  // render so we never call setState inside an effect to "clamp" a stale
  // selection.
  const selected: string | null = useMemo(() => {
    const tenants: TenantSummary[] = tenantsQ.data ?? [];
    const raw = override ?? params.get("tenant");
    if (raw && tenants.some((t) => t.tenant_id === raw)) return raw;
    return tenants[0]?.tenant_id ?? null;
  }, [override, params, tenantsQ.data]);

  const onSelectTenant = (id: string) => {
    setOverride(id);
    params.set("tenant", id);
    setParams(params, { replace: true });
  };

  const [provisioning, setProvisioning] = useState(false);

  const deleteMut = useMutation({
    mutationFn: deleteTenant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants"] });
    },
  });

  return (
    <>
      <ConsoleShell
        tenants={tenantsQ.data ?? []}
        selected={selected}
        onSelectTenant={onSelectTenant}
        onProvision={() => setProvisioning(true)}
        onDeleteTenant={(id) => deleteMut.mutate(id)}
      />

      {provisioning && (
        <ProvisionDialog
          onCancel={() => setProvisioning(false)}
          onCreated={(t) => {
            setProvisioning(false);
            qc.invalidateQueries({ queryKey: ["tenants"] });
            onSelectTenant(t.tenant_id);
          }}
        />
      )}
    </>
  );
}
