import { $, api, loadVisit, longDate } from './common.js';

await loadVisit();

// A browser that has already submitted a scorecard shows the score and goes straight to the results.
try {
  const { report } = await api('/scorecard/report');
  if (report) {
    const status = $('scorecard-status');
    status.textContent = `Your score: ${report.result.total} out of 40, ${report.result.band.name}. Completed ${longDate(report.createdAt)}.`;
    status.hidden = false;
    $('scorecard-link').firstChild.textContent = 'View your results ';
  }
} catch { /* The scorecard page reports any problem when it is opened. */ }
