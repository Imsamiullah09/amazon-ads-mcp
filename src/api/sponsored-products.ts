import type { AdsHttpClient } from "../http/client.js";

/**
 * Sponsored Products v3.
 * Every SP v3 endpoint uses entity-versioned media types on both
 * Content-Type and Accept, and list endpoints are POST .../list.
 * https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi
 */
const MEDIA = {
  campaign: "application/vnd.spCampaign.v3+json",
  adGroup: "application/vnd.spAdGroup.v3+json",
  keyword: "application/vnd.spKeyword.v3+json",
  target: "application/vnd.spTargetingClause.v3+json",
  productAd: "application/vnd.spProductAd.v3+json",
} as const;

export interface SpListParams {
  profileId: string;
  maxResults?: number;
  nextToken?: string;
  /** Entity states to include, e.g. ["ENABLED", "PAUSED"]. */
  stateFilter?: string[];
  campaignIds?: string[];
  adGroupIds?: string[];
}

interface SpListBody {
  maxResults?: number;
  nextToken?: string;
  stateFilter?: { include: string[] };
  campaignIdFilter?: { include: string[] };
  adGroupIdFilter?: { include: string[] };
}

function buildBody(p: SpListParams): SpListBody {
  const body: SpListBody = {};
  if (p.maxResults) body.maxResults = p.maxResults;
  if (p.nextToken) body.nextToken = p.nextToken;
  if (p.stateFilter?.length) body.stateFilter = { include: p.stateFilter };
  if (p.campaignIds?.length) body.campaignIdFilter = { include: p.campaignIds };
  if (p.adGroupIds?.length) body.adGroupIdFilter = { include: p.adGroupIds };
  return body;
}

async function spList<T>(
  client: AdsHttpClient,
  path: string,
  media: string,
  p: SpListParams,
): Promise<T> {
  return client.request<T>({
    method: "POST",
    path,
    body: buildBody(p),
    profileId: p.profileId,
    contentType: media,
    accept: media,
  });
}

export interface SpCampaignList {
  campaigns: unknown[];
  totalResults?: number;
  nextToken?: string;
}
export interface SpAdGroupList {
  adGroups: unknown[];
  totalResults?: number;
  nextToken?: string;
}
export interface SpKeywordList {
  keywords: unknown[];
  totalResults?: number;
  nextToken?: string;
}
export interface SpTargetList {
  targetingClauses: unknown[];
  totalResults?: number;
  nextToken?: string;
}
export interface SpProductAdList {
  productAds: unknown[];
  totalResults?: number;
  nextToken?: string;
}

export const listCampaigns = (c: AdsHttpClient, p: SpListParams) =>
  spList<SpCampaignList>(c, "/sp/campaigns/list", MEDIA.campaign, p);

export const listAdGroups = (c: AdsHttpClient, p: SpListParams) =>
  spList<SpAdGroupList>(c, "/sp/adGroups/list", MEDIA.adGroup, p);

export const listKeywords = (c: AdsHttpClient, p: SpListParams) =>
  spList<SpKeywordList>(c, "/sp/keywords/list", MEDIA.keyword, p);

export const listTargets = (c: AdsHttpClient, p: SpListParams) =>
  spList<SpTargetList>(c, "/sp/targets/list", MEDIA.target, p);

export const listProductAds = (c: AdsHttpClient, p: SpListParams) =>
  spList<SpProductAdList>(c, "/sp/productAds/list", MEDIA.productAd, p);
