import botsData from "@/data/bots.json";
import categoriesData from "@/data/categories.json";

export type Bot = {
  id: number;
  slug: string;
  name: string;
  desc: string;
  toolkits: string[];
  category: string;
  group: string;
  whoPays: string;
  archetype: string;
  tier: "lite" | "standard" | "pro";
  price: number;
  runs: number;
  timeSavedHrs: number;
  moneySavedUsd: number;
  steps: string[];
  why: string;
};

export type CategoryInfo = { category: string; group: string; count: number };

export const bots = botsData as Bot[];
export const categories = categoriesData as CategoryInfo[];

const bySlug = new Map(bots.map((b) => [b.slug, b]));
export const getBot = (slug: string) => bySlug.get(slug);

export const related = (bot: Bot, n = 4) =>
  bots.filter((b) => b.category === bot.category && b.slug !== bot.slug).slice(0, n);

export const GROUPS = [...new Set(categories.map((c) => c.group))];
