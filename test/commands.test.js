import test from 'node:test';
import assert from 'node:assert/strict';
import { commands } from '../src/commands.js';

test('Discord command schema has the expected top-level commands and unique subcommands', () => {
  assert.deepEqual(commands.map((command) => command.name), ['playlist', 'song', 'account']);
  for (const command of commands) {
    const subcommands = command.options.map((option) => option.name);
    assert.equal(new Set(subcommands).size, subcommands.length, `${command.name} has duplicate subcommands`);
    assert.ok(command.description.length > 0);
  }
});

test('critical Discord options retain bounds, choices, and autocomplete contracts', () => {
  const song = commands.find((command) => command.name === 'song');
  const suggest = song.options.find((option) => option.name === 'suggest');
  const count = suggest.options.find((option) => option.name === 'count');
  const mode = suggest.options.find((option) => option.name === 'mode');
  assert.deepEqual([count.min_value, count.max_value], [1, 10]);
  assert.deepEqual(mode.choices.map((choice) => choice.value), ['balanced', 'discovery', 'improvement']);

  const playlist = commands.find((command) => command.name === 'playlist');
  const addSong = playlist.options.find((option) => option.name === 'add-song');
  assert.equal(addSong.options.find((option) => option.name === 'name').autocomplete, true);
  assert.equal(addSong.options.find((option) => option.name === 'song_query').autocomplete, true);

  const account = commands.find((command) => command.name === 'account');
  assert.ok(account.options.some((option) => option.name === 'link'));
  assert.ok(account.options.some((option) => option.name === 'unlink'));
});
