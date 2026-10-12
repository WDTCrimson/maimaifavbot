import { EmbedBuilder } from 'discord.js';
import { commands } from './commands.js';

const FIELD_LIMIT = 1024;

function commandLines(command) {
  return (command.options || []).map((option) =>
    `\`/${command.name} ${option.name}\` — ${option.description}`
  );
}

function splitLines(lines) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > FIELD_LIMIT && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function buildHelpEmbed() {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('MaiDeck Help')
    .setDescription([
      'Tools for maimai DX International songs, linked-account progress, and favorite-song playlists.',
      '',
      '**Start here:** use `/account link` to connect your account, `/song info` to inspect a chart, or `/playlist create` to build a practice list.'
    ].join('\n'));

  for (const command of commands.filter((entry) => entry.name !== 'help')) {
    const chunks = splitLines(commandLines(command));
    chunks.forEach((value, index) => {
      embed.addFields({
        name: index === 0 ? `/${command.name}` : `/${command.name} (continued)`,
        value
      });
    });
  }

  return embed.setFooter({
    text: 'Type a command in Discord to see its options. Most replies are private unless they are designed to be shared.'
  });
}
