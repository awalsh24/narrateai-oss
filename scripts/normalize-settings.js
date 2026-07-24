#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LIBRARY_PATH = path.join(__dirname, '../src/library.json');

const library = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
const totalBefore = library.length;

let manAloneCount = 0;
let warriorBattleCount = 0;

const updated = library.map(clip => {
  if (clip.asset_type !== 'video' && clip.asset_type !== 'image') {
    return clip;
  }

  if (clip.setting_detail === 'man_alone') {
    manAloneCount++;
    return { ...clip, setting_secondary: clip.setting, setting: 'man_alone' };
  }

  if (clip.setting_detail === 'warrior_battle') {
    warriorBattleCount++;
    return { ...clip, setting_secondary: clip.setting, setting: 'warrior_battle' };
  }

  return clip;
});

const totalAfter = updated.length;

if (totalBefore !== totalAfter) {
  console.error(`ERROR: clip count changed! before=${totalBefore} after=${totalAfter}`);
  process.exit(1);
}

fs.writeFileSync(LIBRARY_PATH, JSON.stringify(updated, null, 2));

console.log(`Updated to man_alone:      ${manAloneCount}`);
console.log(`Updated to warrior_battle: ${warriorBattleCount}`);
console.log(`Total clips (unchanged):   ${totalAfter} (before: ${totalBefore})`);
