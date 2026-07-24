import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface AuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  login: string;
}

export interface TwitchCredentials {
  clientId: string;
  token: string;
  broadcasterUserId: string;
  userId: string;
  login: string;
}

export class TwitchAuth {
  private data?: StoredAuth;
  private expectedState?: string;

  constructor(private readonly options: AuthOptions, private readonly filePath: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredAuth;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not load Twitch login:", error);
    }
  }

  get configured(): boolean {
    return Boolean(this.options.clientId && this.options.clientSecret && this.options.redirectUri);
  }

  get login(): string | null {
    return this.data?.login ?? null;
  }

  authorizationUrl(): string {
    if (!this.configured) throw new Error("Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env first.");
    this.expectedState = crypto.randomBytes(24).toString("hex");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: "user:read:chat",
      state: this.expectedState,
      force_verify: "true",
    });
    return `https://id.twitch.tv/oauth2/authorize?${query}`;
  }

  async exchangeCode(code: string, state: string): Promise<TwitchCredentials> {
    if (!this.expectedState || state !== this.expectedState) throw new Error("OAuth state did not match. Start the Twitch login again.");
    this.expectedState = undefined;
    const token = await this.tokenRequest({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.options.redirectUri,
    });
    this.data = await this.identify(token.access_token, token.refresh_token, token.expires_in);
    this.save();
    return this.credentials();
  }

  async resume(): Promise<TwitchCredentials | null> {
    if (!this.configured || !this.data) return null;
    try {
      const validation = await this.validate(this.data.accessToken);
      if (validation.expires_in > 300) {
        this.data.expiresAt = Date.now() + validation.expires_in * 1000;
        return this.credentials();
      }
    } catch {
      // An expired access token is expected and handled by refreshing below.
    }
    return this.refresh();
  }

  clear(): void {
    this.data = undefined;
    try { fs.unlinkSync(this.filePath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async refresh(): Promise<TwitchCredentials> {
    if (!this.data?.refreshToken) throw new Error("Twitch login expired; connect Twitch again.");
    const token = await this.tokenRequest({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.data.refreshToken,
    });
    this.data = await this.identify(token.access_token, token.refresh_token, token.expires_in);
    this.save();
    return this.credentials();
  }

  private async identify(accessToken: string, refreshToken: string, expiresIn: number): Promise<StoredAuth> {
    const validation = await this.validate(accessToken);
    if (!validation.scopes?.includes("user:read:chat")) throw new Error("Twitch did not grant user:read:chat.");
    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      userId: validation.user_id,
      login: validation.login,
    };
  }

  private async validate(accessToken: string): Promise<any> {
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Twitch token validation failed (${response.status}).`);
    return response.json();
  }

  private async tokenRequest(values: Record<string, string>): Promise<any> {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
    });
    if (!response.ok) throw new Error(`Twitch login failed (${response.status}): ${await response.text()}`);
    return response.json();
  }

  private credentials(): TwitchCredentials {
    if (!this.data) throw new Error("Twitch is not logged in.");
    return {
      clientId: this.options.clientId,
      token: this.data.accessToken,
      broadcasterUserId: this.data.userId,
      userId: this.data.userId,
      login: this.data.login,
    };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
}
