import { retrieve } from "@/assistant/memory";
import type { AgenticMessage } from "./types";

export type MemoryHit = { facts: string[]; episodes: string[] };

export interface MemoryStore {
  addFact(userId: string, text: string): Promise<void>;
  recall(userId: string, query: string): Promise<MemoryHit>;
  addEpisode(userId: string, episode: { threadId: string; summary: string; lesson: string }): Promise<void>;
}

type Fact = { id: string; userId: string; text: string; embedding?: number[] };
type Episode = { id: string; userId: string; summary: string; lesson: string; embedding?: number[] };

export function memoryMemoryStore(): MemoryStore {
  const facts: Fact[] = [];
  const episodes: Episode[] = [];
  return {
    async addFact(userId, text) {
      facts.push({ id: `f-${facts.length}`, userId, text: text.slice(0, 500) });
    },
    async recall(userId, query) {
      const ownedFacts = facts.filter((fact) => fact.userId === userId);
      const ownedEpisodes = episodes.filter((episode) => episode.userId === userId);
      const factHits = retrieve(
        query,
        ownedFacts.map((fact) => ({ id: fact.id, text: fact.text, userId: fact.userId, embedding: fact.embedding })),
        { userId, limit: 5, minScore: 0.05 }
      );
      const episodeHits = retrieve(
        query,
        ownedEpisodes.map((episode) => ({
          id: episode.id,
          text: `${episode.summary} ${episode.lesson}`,
          userId: episode.userId,
          embedding: episode.embedding,
        })),
        { userId, limit: 3, minScore: 0.05 }
      );
      return {
        facts: factHits.map((hit) => hit.text),
        episodes: episodeHits.map((hit) => hit.text),
      };
    },
    async addEpisode(userId, episode) {
      episodes.push({
        id: `e-${episodes.length}`,
        userId,
        summary: episode.summary.slice(0, 500),
        lesson: episode.lesson.slice(0, 500),
      });
    },
  };
}

export function messageChars(messages: AgenticMessage[]): number {
  return JSON.stringify(messages).length;
}

/** Replace older turns with a summary. Keeps the latest tool pair intact. */
export function compactMessages(messages: AgenticMessage[], summary: string): AgenticMessage[] {
  const tail = messages.slice(-6);
  if (tail[0] && tail[0].role === "user" && Array.isArray(tail[0].content) && tail[0].content.some((block) => block.type === "tool_result")) {
    const previous = messages[messages.length - tail.length - 1];
    if (previous) tail.unshift(previous);
  }
  return [
    { role: "user", content: `Summary of earlier turns:\n${summary}` },
    { role: "assistant", content: [{ type: "text", text: "I'll use that summary as earlier context." }] },
    ...tail,
  ];
}

export function fallbackSummary(messages: AgenticMessage[]): string {
  const lines = messages.slice(0, -6).flatMap((message) => {
    const text = typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text").map((block) => block.text).join(" ");
    return text.trim() ? [`${message.role}: ${text.trim().slice(0, 180)}`] : [];
  });
  return lines.slice(-12).join("\n").slice(0, 2000) || "Earlier turns were compacted.";
}
