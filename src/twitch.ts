import WebSocket from "ws";
import type { Game } from "./game.js";
import type { TwitchCredentials } from "./twitch-auth.js";

export class TwitchChat {
  private socket?: WebSocket;
  private intentionalClose = false;
  private seenMessages = new Set<string>();

  private options?: TwitchCredentials;

  constructor(private readonly game: Game, private readonly label = "streamer") {}

  connect(
    options: TwitchCredentials,
    url = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30",
    reusingSession = false,
  ): void {
    this.options = options;
    this.intentionalClose = false;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on("message", (raw) => {
      void this.handle(JSON.parse(raw.toString()), reusingSession).catch((error) => {
        console.error(`[${this.label}] Twitch EventSub message failed:`, (error as Error).message);
        socket.close();
      });
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.game.twitchConnected = false;
      this.game.enterSetup();
      if (!this.intentionalClose && this.options) setTimeout(() => this.connect(this.options!), 5000);
    });
    socket.on("error", (error) => console.error(`[${this.label}] Twitch EventSub error:`, error.message));
  }

  close(): void {
    this.intentionalClose = true;
    this.socket?.close();
    this.game.twitchConnected = false;
    this.game.enterSetup();
  }

  private async handle(message: any, reusingSession: boolean): Promise<void> {
    const type = message.metadata?.message_type;
    if (type === "session_welcome") {
      if (!reusingSession) await this.subscribe(message.payload.session.id);
      this.game.twitchConnected = true;
      this.game.emit("change", this.game.state());
      return;
    }
    if (type === "session_reconnect") {
      const oldSocket = this.socket;
      this.connect(this.options!, message.payload.session.reconnect_url, true);
      oldSocket?.close();
      return;
    }
    if (type !== "notification" || message.metadata.subscription_type !== "channel.chat.message") return;
    const messageId = message.metadata.message_id as string;
    if (this.seenMessages.has(messageId)) return;
    this.seenMessages.add(messageId);
    if (this.seenMessages.size > 1000) this.seenMessages.delete(this.seenMessages.values().next().value!);
    const event = message.payload.event;
    this.game.submit(event.chatter_user_id, event.chatter_user_name, event.message.text);
  }

  private async subscribe(sessionId: string): Promise<void> {
    if (!this.options) throw new Error("Twitch credentials are missing.");
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Client-Id": this.options.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: this.options.broadcasterUserId,
          user_id: this.options.userId,
        },
        transport: { method: "websocket", session_id: sessionId },
      }),
    });
    if (!response.ok) {
      this.game.twitchConnected = false;
      throw new Error(`Twitch subscription failed (${response.status}): ${await response.text()}`);
    }
    this.game.start();
  }
}
