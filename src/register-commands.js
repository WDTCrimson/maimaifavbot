import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';

const rest = new REST({ version: '10' }).setToken(config.token);

async function register() {
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands
    });
    console.log(`Registered ${commands.length} guild command(s) to guild ${config.guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), {
    body: commands
  });
  console.log(`Registered ${commands.length} global command(s).`);
  console.log('Global command updates can take up to ~1 hour to appear.');
}

register().catch((error) => {
  console.error('Failed to register commands:', error);
  process.exitCode = 1;
});
