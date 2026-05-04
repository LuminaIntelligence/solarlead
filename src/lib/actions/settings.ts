"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { UserSettings, ScoringWeights } from "@/types/database";

const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  business: 0.25,
  electricity: 0.25,
  solar: 0.25,
  outreach: 0.25,
};

export async function getUserSettings(): Promise<UserSettings | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("Error in getUserSettings: user not authenticated");
      return null;
    }

    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error && error.code === "PGRST116") {
      // No row found — create default settings
      const { data: created, error: createError } = await supabase
        .from("user_settings")
        .insert({
          user_id: user.id,
          google_places_api_key: null,
          google_solar_api_key: null,
          provider_mode: "mock",
          scoring_weights: DEFAULT_SCORING_WEIGHTS,
        })
        .select()
        .single();

      if (createError) {
        console.error("Error creating default user settings:", createError);
        return null;
      }

      return created as UserSettings;
    }

    if (error) {
      console.error("Error fetching user settings:", error);
      return null;
    }

    return data as UserSettings;
  } catch (error) {
    console.error("Error in getUserSettings:", error);
    return null;
  }
}

export async function updateUserSettings(
  data: Partial<
    Pick<
      UserSettings,
      | "google_places_api_key"
      | "google_solar_api_key"
      | "provider_mode"
      | "scoring_weights"
      | "email_sender_name"
      | "email_sender_title"
      | "email_sender_email"
      | "email_sender_phone"
      | "places_daily_budget_eur"
      | "alert_email"
    >
  >
): Promise<UserSettings | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("Error in updateUserSettings: user not authenticated");
      return null;
    }

    const { data: updated, error } = await supabase
      .from("user_settings")
      .update(data)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating user settings:", error);
      return null;
    }

    revalidatePath("/dashboard/settings");

    return updated as UserSettings;
  } catch (error) {
    console.error("Error in updateUserSettings:", error);
    return null;
  }
}
