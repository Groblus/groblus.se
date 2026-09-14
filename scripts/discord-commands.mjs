/** Prints command JSON by default. Explicit --register makes the remote write. */
const string = (name, description, max_length) => ({
  type: 3,
  name,
  description,
  required: true,
  max_length,
});
export const command = {
  name: "groblus",
  description: "Din spelhylla, vanliga tider och spelplaner",
  type: 1,
  options: [
    {
      type: 1,
      name: "profil",
      description: "Välj spel du vill spela och spelleda",
    },
    {
      type: 1,
      name: "tider",
      description: "Uppdatera dina vanliga dagar och tider",
    },
    {
      type: 1,
      name: "planer",
      description: "Se spelplaner och svara på datumförslag",
    },
    {
      type: 1,
      name: "registrera",
      description: "Skapa din profil med föreningens inbjudan",
      options: [
        string("namn", "Ditt visningsnamn", 60),
        string("inbjudan", "Inbjudningskod från föreningen", 200),
      ],
    },
    {
      type: 1,
      name: "koppla",
      description: "Koppla Discord till din befintliga profil på hemsidan",
      options: [
        string("kod", "Engångskod skapad i din profil på hemsidan", 200),
      ],
    },
  ],
};
if (process.argv.includes("--register")) {
  const {
    DISCORD_APPLICATION_ID: app,
    DISCORD_GUILD_ID: guild,
    DISCORD_BOT_TOKEN: token,
  } = process.env;
  if (!/^\d+$/.test(app ?? "") || !/^\d+$/.test(guild ?? "") || !token)
    throw new Error(
      "Set DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN in the environment.",
    );
  // POST is an upsert by command name; do not overwrite other guild commands.
  const response = await fetch(
    `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    },
  );
  if (!response.ok)
    throw new Error(
      `Discord command registration failed (${response.status}).`,
    );
  console.log("Registered /groblus in the configured guild.");
} else console.log(JSON.stringify(command, null, 2));
