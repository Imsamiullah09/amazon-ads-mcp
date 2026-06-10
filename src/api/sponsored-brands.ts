import type { AdsHttpClient } from "../http/client.js";

/**
 * Sponsored Brands v4 (campaigns / ad groups).
 * SB v4 uses POST .../list with versioned media types, lower-cased
 * resource names in the vendor type.
 * https://advertising.amazon.com/API/docs/en-us/sponsored-brands/3-0/openapi/prod
 */
const MEDIA = {
  campaign: "application/vnd.sbcampaignresource.v4+json",
  adGroup: "application/vnd.sbadgroupresource.v4+json",
} as const;

export interface SbListParams {
  profileId: string;
  maxResults?: number;
  nextToken?: string;
  stateFilter?: string[];
  campaignIds?: string[];
}

function buildBody(p: SbListParams) {
  const body: Record<string, unknown> = {};
  if (p.maxResults) body.maxResults = p.maxResults;
  if (p.nextToken) body.nextToken = p.nextToken;
  if (p.stateFilter?.length) body.stateFilter = { include: p.stateFilter };
  if (p.campaignIds?.length) body.campaignIdFilter = { include: p.campaignIds };
  return body;
}

export interface SbCampaignList {
  campaigns: unknown[];
  nextToken?: string;
}
export interface SbAdGroupList {
  adGroups: unknown[];
  nextToken?: string;
}

export async function listCampaigns(
  client: AdsHttpClient,
  p: SbListParams,
): Promise<SbCampaignList> {
  return client.request<SbCampaignList>({
    method: "POST",
    path: "/sb/v4/campaigns/list",
    body: buildBody(p),
    profileId: p.profileId,
    contentType: MEDIA.campaign,
    accept: MEDIA.campaign,
  });
}

export async function listAdGroups(
  client: AdsHttpClient,
  p: SbListParams,
): Promise<SbAdGroupList> {
  return client.request<SbAdGroupList>({
    method: "POST",
    path: "/sb/v4/adGroups/list",
    body: buildBody(p),
    profileId: p.profileId,
    contentType: MEDIA.adGroup,
    accept: MEDIA.adGroup,
  });
}
