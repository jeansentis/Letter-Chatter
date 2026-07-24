import fs from "node:fs";
import path from "node:path";
import type { PlayerScore, ScoreFile } from "./types.js";

export class ScoreStore {
  private data: ScoreFile = { players: {} };

  constructor(private readonly filePath: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(filePath, "utf8")) as ScoreFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not load scores:", error);
    }
  }

  add(userId: string, username: string, score: number): void {
    const current = this.data.players[userId] ?? { username, score: 0 };
    this.data.players[userId] = { username, score: current.score + score };
    this.save();
  }

  top(limit = 3): PlayerScore[] {
    return Object.entries(this.data.players)
      .map(([userId, player]) => ({ userId, ...player }))
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
      .slice(0, limit);
  }

  highestLevel(): number {
    return Math.max(1, Math.round(this.data.highestLevel ?? 1));
  }

  recordLevel(level: number): void {
    if (level <= this.highestLevel()) return;
    this.data.highestLevel = Math.round(level);
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2));
    fs.renameSync(temp, this.filePath);
  }
}
