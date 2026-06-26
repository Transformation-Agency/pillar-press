/* Library helpers shared by the desktop UI and browser tests. */
(function () {
  function pieceCounts(campaigns, allPieces) {
    const counts = {};
    (campaigns || []).forEach((c) => {
      if (c && c.id) counts[c.id] = Number(c.pieceCount || 0);
    });
    const loadedCounts = {};
    (allPieces || []).forEach((p) => {
      if (!p || !p.campaignId) return;
      loadedCounts[p.campaignId] = (loadedCounts[p.campaignId] || 0) + 1;
    });
    Object.keys(loadedCounts).forEach((id) => {
      counts[id] = loadedCounts[id];
    });
    return counts;
  }

  function campaignsWithRestoredPieces(campaigns, allPieces, activeCampaignId, limit) {
    const counts = pieceCounts(campaigns, allPieces);
    return (campaigns || [])
      .filter((c) => c && c.id !== activeCampaignId && (counts[c.id] || 0) > 0)
      .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || String(a.name || "").localeCompare(String(b.name || "")))
      .slice(0, limit || 4)
      .map((campaign) => ({
        campaign,
        count: counts[campaign.id] || 0,
      }));
  }

  window.LIBRARY = { pieceCounts, campaignsWithRestoredPieces };
})();
