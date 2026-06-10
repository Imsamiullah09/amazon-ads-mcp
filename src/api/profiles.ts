import type { AdsHttpClient } from "../http/client.js";

export interface Profile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  accountInfo: {
    marketplaceStringId: string;
    id: string;
    type: string;
    name?: string;
    subType?: string;
  };
  dailyBudget?: number;
}

/**
 * GET /v2/profiles — the entry point for everything else.
 * Each profile is an advertiser account in one marketplace; its profileId
 * becomes the Amazon-Advertising-API-Scope header on subsequent calls.
 */
export async function listProfiles(client: AdsHttpClient): Promise<Profile[]> {
  return client.request<Profile[]>({
    method: "GET",
    path: "/v2/profiles",
  });
}
