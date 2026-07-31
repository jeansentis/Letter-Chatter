import WebSocket from "ws";
import type { Game } from "./game.js";
import type { TwitchCredentials } from "./twitch-auth.js";

export class TwitchChat {
  private socket?: WebSocket;
  private shouldConnect = false;
  private loggedConnected = false;
  private seenMessages = new Set<string>();
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;

  private options?: TwitchCredentials;

  constructor(private readonly game: Game, private readonly label = "streamer") {}

  connect(
    options: TwitchCredentials,
    url = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30",
    reusingSession = false,
  ): void {
    this.options = options;
    this.shouldConnect = true;
    if (!reusingSession && this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
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
      const wasConnected = this.loggedConnected;
      this.loggedConnected = false;
      this.game.twitchConnected = false;
      this.game.enterSetup();
      this.socket = undefined;
      if (this.shouldConnect && this.options) this.scheduleReconnect(wasConnected);
    });
    socket.on("error", (error) => console.error(`[${this.label}] Twitch EventSub error:`, error.message));
  }

  close(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempt = 0;
    if (this.loggedConnected) console.log(`[${this.label}] Twitch connection closed.`);
    this.loggedConnected = false;
    this.socket?.close();
    this.game.twitchConnected = false;
    this.game.enterSetup();
  }

  private async handle(message: any, reusingSession: boolean): Promise<void> {
    const type = message.metadata?.message_type;
    if (type === "session_welcome") {
      if (!reusingSession) await this.subscribe(message.payload.session.id);
      this.game.twitchConnected = true;
      this.reconnectAttempt = 0;
      if (!this.loggedConnected) console.log(`[${this.label}] Twitch connected.`);
      this.loggedConnected = true;
      this.game.emit("change", this.game.state());
      if (!reusingSession) this.game.start();
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

  private scheduleReconnect(wasConnected: boolean): void {
    if (this.reconnectTimer || !this.options) return;
    const baseDelay = Math.min(5_000 * (2 ** this.reconnectAttempt), 5 * 60_000);
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    const description = delay < 60_000
      ? `${Math.ceil(delay / 1000)} seconds`
      : `${Math.ceil(delay / 60_000)} minutes`;
    if (wasConnected || this.reconnectAttempt > 1) {
      console.log(`[${this.label}] Twitch disconnected; reconnecting in ${description}.`);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.shouldConnect && this.options) this.connect(this.options);
    }, delay);
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
  }
}
