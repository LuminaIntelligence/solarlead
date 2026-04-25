export type UserRole = "admin" | "user";

export type LeadStatus = "new" | "reviewed" | "contacted" | "qualified" | "rejected";
export type LeadSource = "google_places" | "csv_import" | "manual";

export interface Lead {
  id: string;
  user_id: string;
  company_name: string;
  category: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  source: LeadSource;
  business_score: number;
  electricity_score: number;
  outreach_score: number;
  solar_score: number;
  total_score: number;
  status: LeadStatus;
  notes: string | null;
  linkedin_url: string | null;
  employee_count?: number | null;
  deal_value?: number | null;
  next_contact_date?: string | null;
  win_probability?: number | null;
  claimed_by?: string | null;
  is_pool_lead?: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

export type DiscoveryCampaignStatus = "pending" | "running" | "completed" | "failed" | "paused";
export type DiscoveryLeadStatus = "pending_enrichment" | "enriching" | "ready" | "insufficient_data" | "approved" | "rejected";

export interface DiscoveryCampaignArea {
  /** "city" = text search by city name; "radius" = coordinate-based circle search */
  type: "city" | "radius";
  value: string;           // display label (e.g. "München", "Nürnberg 60 km")
  lat?: number;            // center latitude  (required for type="radius")
  lng?: number;            // center longitude (required for type="radius")
  radius_km?: number;      // search radius in km (required for type="radius")
}

export interface DiscoveryCampaign {
  id: string;
  created_by: string;
  name: string;
  description: string | null;
  status: DiscoveryCampaignStatus;
  areas: DiscoveryCampaignArea[];
  categories: string[];
  search_keyword: string | null;
  auto_approve_threshold: number | null;
  total_discovered: number;
  total_enriched: number;
  total_ready: number;
  total_approved: number;
  total_duplicates: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveryLead {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  company_name: string;
  address: string;
  city: string;
  postal_code: string | null;
  country: string;
  category: string;
  website: string | null;
  phone: string | null;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  total_score: number | null;
  has_contacts: boolean;
  has_solar_data: boolean;
  contact_count: number;
  solar_quality: string | null;
  max_array_area_m2: number | null;
  roof_area_m2: number | null;
  place_name: string | null;
  contacts: { name?: string; email?: string; title?: string }[] | null;
  status: DiscoveryLeadStatus;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadContact {
  id: string;
  lead_id: string;
  user_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  apollo_id: string | null;
  seniority: string | null;
  department: string | null;
  source: string;
  created_at: string;
}

export interface SolarAssessment {
  id: string;
  lead_id: string;
  provider: string;
  latitude: number;
  longitude: number;
  solar_quality: string | null;
  max_array_panels_count: number | null;
  max_array_area_m2: number | null;
  annual_energy_kwh: number | null;
  sunshine_hours: number | null;
  carbon_offset: number | null;
  segment_count: number | null;
  panel_capacity_watts: number | null;
  raw_response_json: Record<string, unknown> | null;
  created_at: string;
}

export interface LeadEnrichment {
  id: string;
  lead_id: string;
  website_title: string | null;
  meta_description: string | null;
  detected_keywords: string[];
  enrichment_score: number;
  created_at: string;
}

export interface SearchRun {
  id: string;
  user_id: string;
  query: string;
  filters: Record<string, unknown>;
  results_count: number;
  created_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  google_places_api_key: string | null;
  google_solar_api_key: string | null;
  provider_mode: "mock" | "live";
  scoring_weights: ScoringWeights;
  created_at: string;
  updated_at: string;
}

export interface ScoringWeights {
  business: number;
  electricity: number;
  solar: number;
  outreach: number;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  user_id: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  subject: string | null;
  description: string | null;
  activity_date: string;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
}

// Type for lead with relations
export interface LeadWithRelations extends Lead {
  solar_assessments?: SolarAssessment[];
  lead_enrichment?: LeadEnrichment[];
  lead_contacts?: LeadContact[];
  lead_activities?: LeadActivity[];
}

export type OutreachJobStatus = "pending" | "sent" | "opened" | "replied" | "bounced" | "opted_out";
export type OutreachBatchStatus = "draft" | "active" | "paused" | "completed";

export interface OutreachBatch {
  id: string;
  created_by: string;
  name: string;
  description: string | null;
  status: OutreachBatchStatus;
  daily_limit: number;
  total_leads: number;
  sent_count: number;
  replied_count: number;
  template_type: string;
  // Follow-up automation
  followup_enabled: boolean;
  followup_days: number;
  followup_template: string;
  followup_sent_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type FollowupStatus = "pending" | "sent" | "skipped" | "cancelled";

export interface OutreachJob {
  id: string;
  batch_id: string;
  lead_id: string;
  contact_id: string | null;
  status: OutreachJobStatus;
  contact_name: string | null;
  contact_email: string | null;
  contact_title: string | null;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  roof_area_m2: number | null;
  personalized_subject: string | null;
  personalized_body: string | null;
  sent_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  reply_content: string | null;
  assigned_to: string | null;
  scheduled_for: string | null;
  // Follow-up
  followup_scheduled_for: string | null;
  followup_sent_at: string | null;
  followup_status: FollowupStatus;
  created_at: string;
  updated_at: string;
}
