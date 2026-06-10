import type { AdsHttpClient } from "../http/client.js";

/**
 * Sponsored Display (legacy-style GET endpoints with index pagination).
 * Note: Amazon is migrating managed-service display advertisers toward
 * Amazon DSP; the SD self-service API remains available for self-service
 * accounts.
 * https://advertising.amazon.com/API/docs/en-us/sponsored-display/3-0/openapi
 */
export interface SdListParams {
  profileId: string;
  startIndex?: number;
  count?: number;
  /** Comma-joined server-side, e.g. ["enabled","paused"]. */
  stateFilter?: string[];
}

function query(p: SdListParams) {
  return {
    startIndex: p.startIndex,
    count: p.count,
    stateFilter: p.stateFilter?.length ? p.stateFilter.join(",") : undefined,
  };
}

export async function listCampaigns(
  client: AdsHttpClient,
  p: SdListParams,
): Promise<unknown[]> {
  return client.request<unknown[]>({
    method: "GET",
    path: "/sd/campaigns",
    query: query(p),
    profileId: p.profileId,
  });
}

export async function listAdGroups(
  client: AdsHttpClient,
  p: SdListParams,
): Promise<unknown[]> {
  return client.request<unknown[]>({
    method: "GET",
    path: "/sd/adGroups",
    query: query(p),
    profileId: p.profileId,
  });
}
