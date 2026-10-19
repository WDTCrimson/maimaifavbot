import test from 'node:test';
import assert from 'node:assert/strict';
import { commands } from '../src/commands.js';
import { buildHelpEmbed } from '../src/help.js';

test('Discord command schema has the expected top-level commands and unique subcommands', () => {
  assert.deepEqual(commands.map((command) => command.name), ['help', 'playlist', 'song', 'account']);
  for (const command of commands) {
    const subcommands = (command.options || []).map((option) => option.name);
    assert.equal(new Set(subcommands).size, subcommands.length, `${command.name} has duplicate subcommands`);
    assert.ok(command.description.length > 0);
  }
});

test('critical Discord options retain bounds, choices, and autocomplete contracts', () => {
  const song = commands.find((command) => command.name === 'song');
  const suggest = song.options.find((option) => option.name === 'suggest');
  assert.deepEqual(suggest.options.find((option) => option.name === 'count').min_value, 1);
  assert.deepEqual(suggest.options.find((option) => option.name === 'count').max_value, 20);
  const pattern = song.options.find((option) => option.name === 'pattern');
  assert.equal(pattern.options.find((option) => option.name === 'tag').autocomplete, true);
  const random = song.options.find((option) => option.name === 'random');
  assert.ok(random.options.some((option) => option.name === 'unplayed'));

  const playlist = commands.find((command) => command.name === 'playlist');
  const addSong = playlist.options.find((option) => option.name === 'add-song');
  assert.equal(addSong.options.find((option) => option.name === 'name').autocomplete, true);
  assert.equal(addSong.options.find((option) => option.name === 'song_query').autocomplete, true);

  const account = commands.find((command) => command.name === 'account');
  assert.ok(account.options.some((option) => option.name === 'link'));
  assert.ok(account.options.some((option) => option.name === 'unlink'));
  const deleteData = account.options.find((option) => option.name === 'delete-data');
  assert.ok(deleteData);
  assert.equal(deleteData.options.find((option) => option.name === 'confirm')?.required, true);
  assert.equal(account.options.find((option) => option.name === 'settings').options.find((option) => option.name === 'history').type, 5);
  const publicProfile = account.options.find((option) => option.name === 'public');
  assert.deepEqual(publicProfile.options.find((option) => option.name === 'action').choices.map((choice) => choice.value), ['enable', 'view', 'disable']);
  for (const name of ['progress', 'history', 'daily', 'roast']) {
    assert.ok(account.options.some((option) => option.name === name), `missing /account ${name}`);
  }
  assert.equal(account.options.some((option) => option.name === 'gap'), false);
  assert.equal(account.options.find((option) => option.name === 'progress').options.find((option) => option.name === 'version').autocomplete, true);
  assert.equal(account.options.find((option) => option.name === 'daily').options.find((option) => option.name === 'date').autocomplete, true);
  const summaryDifficulty = account.options.find((option) => option.name === 'summary').options.find((option) => option.name === 'difficulty');
  assert.equal(summaryDifficulty.required, false);
  assert.deepEqual(summaryDifficulty.choices.map((choice) => choice.value), ['all', 'basic', 'advanced', 'expert', 'master', 'remaster']);
});

test('/help lists every registered feature without Reddit sourcing', () => {
  const json = buildHelpEmbed().toJSON();
  const helpText = [json.description, ...json.fields.flatMap((field) => [field.name, field.value])].join('\n');

  for (const command of commands.filter((entry) => entry.name !== 'help')) {
    for (const option of command.options || []) {
      assert.ok(helpText.includes(`/${command.name} ${option.name}`), `missing /${command.name} ${option.name}`);
    }
  }
  assert.doesNotMatch(helpText, /reddit/i);
  assert.match(json.description, /https:\/\/maideck\.xyz\/terms/);
  assert.match(json.description, /https:\/\/maideck\.xyz\/privacy/);
  assert.ok(json.fields.every((field) => field.value.length <= 1024));
});
