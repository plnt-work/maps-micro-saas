// Home search dispatch — opens a short-lived WS connection (via the
// shared useWsChat hook), sends the freeform envelope, then lets the
// hook tear down on unmount. The actual reply rendering happens once
// the user navigates into a venue/agent surface where ChatPanel mounts;
// for P1, the Home search is just the seed event — we surface
// classify_intent results via console for now.
//
// In P2, Home will route to a global "search results" screen that owns
// the WS for the entire freeform turn. Marked TODO inline.
import { useEffect, useRef } from "react";
import { useWsChat } from "./useWsChat";
import { freeformEnvelope } from "./envelope";
import { env } from "@/lib/env";

interface Opts {
  userLoc?: { lat: number; lng: number } | null;
}

let _pseudoUser = "m-anon";
let _pseudoSession = "s-home";

export function useHomeSearchDispatch({ userLoc }: Opts) {
  // For P1 we use stable per-process ids so a Home->Home repeat keeps the
  // same workflow. Real identity wiring (AsyncStorage-backed) hooks in
  // when the venue / agent screens take over the WS in P2.
  const tenantId = env.defaultTenant;
  const userIdRef = useRef(_pseudoUser);
  const sessionIdRef = useRef(_pseudoSession);

  const { send, status } = useWsChat({
    tenantId,
    sessionId: sessionIdRef.current,
    userId: userIdRef.current,
  });

  // TODO(P2): replace this fire-and-forget with a route to a results
  // screen that mounts useWsChat for the full turn lifetime.
  useEffect(() => {
    // ensure the connection has a beat to come up before sends are
    // attempted (status flips to "connected" via the hook).
  }, [status]);

  return (text: string) => {
    const env_ = freeformEnvelope(text, { userLoc });
    send(env_);
  };
}
