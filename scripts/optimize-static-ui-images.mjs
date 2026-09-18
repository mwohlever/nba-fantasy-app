#!/usr/bin/env node

import sharp from "sharp";

const jobs = [
  ["public/logos/logo_all_sports.png", "public/logos/logo_all_sports.webp", 128],
  ["public/logos/nba.png", "public/logos/nba.webp", 128],
  ["public/logos/nfl.png", "public/logos/nfl.webp", 128],
  ["public/logos/golf.png", "public/logos/golf.webp", 128],
  ["public/team-headshots/mark.jpg", "public/team-headshots/mark.webp", 256],
  ["public/team-headshots/andy.jpg", "public/team-headshots/andy.webp", 256],
  ["public/team-headshots/jon.jpg", "public/team-headshots/jon.webp", 256],
  ["public/team-headshots/josh.jpg", "public/team-headshots/josh.webp", 256],
];

await Promise.all(jobs.map(async ([source, target, size]) => {
  await sharp(source, { failOn: "none", limitInputPixels: 32_000_000 })
    .rotate()
    .resize(size, size, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toFile(target);
  console.log(`optimized ${target}`);
}));
