export interface Env {
  ADMIN_EMAILS?: string;
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ORIGIN: string;
  SITE_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_GUILD_ID?: string;
}
export interface User {
  id: string;
  email: string | null;
  display_name: string;
  discord_id: string | null;
}
