/**
 * Lightweight client-only human check prompts (MCQ).
 * Server still requires a fresh `last_human_check_at` for writes via RLS.
 */

export type HumanMcqChallengeTemplate = {
  id: string;
  prompt: string;
  correct: string;
  incorrect: readonly [string, string];
};

export type HumanMcqChallengeInstance = {
  /** Stable key for React lists when the prompt rotates. */
  instanceKey: string;
  templateId: string;
  prompt: string;
  options: readonly [string, string, string];
  correct: string;
};

const CHALLENGE_BANK: readonly HumanMcqChallengeTemplate[] = [
  { id: "mcq-animal-1", prompt: "Select the animal", correct: "otter", incorrect: ["lamp", "window"] },
  { id: "mcq-color-1", prompt: "Select the color", correct: "blue", incorrect: ["chair", "paper"] },
  { id: "mcq-food-1", prompt: "Select the food", correct: "sandwich", incorrect: ["battery", "curtain"] },
  { id: "mcq-month-1", prompt: "Select the month", correct: "April", incorrect: ["spoon", "engine"] },
  { id: "mcq-instrument-1", prompt: "Select the instrument", correct: "violin", incorrect: ["carpet", "bucket"] },
  { id: "mcq-veg-1", prompt: "Select the vegetable", correct: "broccoli", incorrect: ["novel", "sidewalk"] },
  { id: "mcq-planet-1", prompt: "Select the planet", correct: "Mars", incorrect: ["notebook", "toothbrush"] },
  { id: "mcq-bird-1", prompt: "Select the bird", correct: "crow", incorrect: ["ladder", "pillow"] },
];

function newInstanceKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shuffleThree(a: string, b: string, c: string): readonly [string, string, string] {
  const arr = [a, b, c];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return [arr[0]!, arr[1]!, arr[2]!];
}

export function pickRandomHumanChallenge(): HumanMcqChallengeInstance {
  const t = CHALLENGE_BANK[Math.floor(Math.random() * CHALLENGE_BANK.length)]!;
  const options = shuffleThree(t.correct, t.incorrect[0], t.incorrect[1]);
  return {
    instanceKey: newInstanceKey(),
    templateId: t.id,
    prompt: t.prompt,
    options,
    correct: t.correct,
  };
}
