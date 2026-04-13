import type { SupabaseClient } from "@supabase/supabase-js";

export type RecordAdultAttestationResult =
  | { ok: true; granted: boolean; expires_at: string | null }
  | { ok: false; error: string };

/**
 * Calls {@link public.record_adult_content_self_attestation}; appends an audit row and may refresh the profile snapshot.
 */
export async function recordAdultContentSelfAttestation(
  supabase: SupabaseClient,
  params: {
    isAdult: boolean;
    policyVersion: string;
    promptText: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    countryCode?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<RecordAdultAttestationResult> {
  const { data, error } = await supabase.rpc("record_adult_content_self_attestation", {
    p_is_adult: params.isAdult,
    p_policy_version: params.policyVersion,
    p_prompt_text: params.promptText,
    p_ip_hash: params.ipHash ?? null,
    p_user_agent_hash: params.userAgentHash ?? null,
    p_country_code: params.countryCode ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as { ok?: boolean; error?: string; granted?: boolean; expires_at?: string | null } | null;
  if (!row || row.ok !== true) {
    return { ok: false, error: row?.error ?? "attestation_failed" };
  }

  return {
    ok: true,
    granted: Boolean(row.granted),
    expires_at: row.expires_at ?? null,
  };
}
