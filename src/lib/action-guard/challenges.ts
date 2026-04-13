/**
 * Local-only challenge (replace with DB-backed flow later).
 * Server still requires a fresh `last_human_check_at` for writes via RLS.
 */
export type HumanChallenge = {
  id: string;
  prompt: string;
  validate: (normalizedAnswer: string) => boolean;
};

export function getCurrentHumanChallenge(): HumanChallenge {
  return {
    id: "phrase-human-v1",
    prompt: 'Type the word "human" (any letters) to continue.',
    validate: (n) => n === "human",
  };
}
