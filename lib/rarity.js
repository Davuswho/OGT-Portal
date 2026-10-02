// Rarity helpers — tier banding (presentation) + offline computation used by the bake job.
// OpenSea's own OpenRarity rank is the live backbone; computeStatRanks() is the fallback when
// a collection has no OpenSea ranks.
'use strict';

// Rarity tier = band of the OpenRarity percentile (rank ÷ supply). Colors are ours, not OpenSea's.
function tierOf(pr) {
  if (pr <= 0.01) return { cls: 'tier-grail', label: '🟠 Legendary · Top 1%' };
  if (pr <= 0.10) return { cls: 'tier-rare', label: '🟣 Epic · Top 10%' };
  if (pr <= 0.50) return { cls: 'tier-uncommon', label: '🔵 Uncommon · Top 50%' };
  return { cls: 'tier-common', label: '⚪ Common · Bottom 50%' };
}

// all = { id: [[type,value],...] } → { total, s: { type: { value: count } } }
function computeRarity(all) {
  var ids = Object.keys(all), total = ids.length, s = {};
  ids.forEach(function (id) {
    (all[id] || []).forEach(function (p) {
      var t = p[0], v = String(p[1]);
      if (!s[t]) s[t] = {};
      s[t][v] = (s[t][v] || 0) + 1;
    });
  });
  return { total: total, s: s };
}

// Statistical rank (rarity-score method): score = Σ 1/(traitFrequency). Rarer traits → higher
// score → better (lower) rank. Used only when OpenSea OpenRarity ranks are unavailable.
function computeStatRanks(all, rarity) {
  var total = rarity.total || Object.keys(all).length;
  var scores = Object.keys(all).map(function (id) {
    var sc = 0;
    (all[id] || []).forEach(function (p) {
      var c = (rarity.s[p[0]] && rarity.s[p[0]][String(p[1])]) || 1;
      sc += 1 / (c / total);
    });
    return { id: id, score: sc };
  });
  scores.sort(function (a, b) { return b.score - a.score; });
  var ranks = {};
  scores.forEach(function (o, i) { ranks[o.id] = i + 1; });
  return ranks;
}

module.exports = { tierOf: tierOf, computeRarity: computeRarity, computeStatRanks: computeStatRanks };
