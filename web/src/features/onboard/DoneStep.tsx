import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";

import { CopyField } from "./CopyField";

/**
 * Step 5 — the share card. tenant_id === slug (create returns the slug
 * as tenant_id), so the URL param is all this step needs.
 *
 * "Open your chat" links to plain /atlas: Atlas currently reads its
 * tenant from VITE_DEFAULT_TENANT only (no ?tenant= override) — adding
 * one is an Atlas change outside this slice, flagged in the report.
 */
export function DoneStep({ tenantId }: { tenantId: string }) {
  const shareUrl = `https://${tenantId}.plnt.chat`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink-700">Your agent is live</h1>
      <p className="text-sm text-ink-200">
        Share this link — customers who open it can chat and book directly.
      </p>
      <CopyField value={shareUrl} label="share link" />
      <div className="flex items-center gap-3">
        <Button asChild>
          <Link to="/atlas">Open your chat</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/console?tenant=${encodeURIComponent(tenantId)}`}>
            Open your dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
